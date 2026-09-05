import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  FileAudio2,
  Image,
  Link2,
  Loader2,
  ShieldCheck,
  UploadCloud,
  Youtube,
  X,
} from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import {
  createCoverUploadSession,
  createUploadSession,
  importYoutubeTrack,
  processUploadedTrack,
  uploadFileToS3,
} from '../api/tracks';
import { useLibrary } from '../state/LibraryContext';
import { UploadStage } from '../types';
import { LANGUAGE_OPTIONS } from '../utils/languages';

const GENRES = ['Electronic', 'Indie', 'Alternative', 'Acoustic', 'Pop', 'Rock'];
const ACCEPTED_COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_YOUTUBE_URLS = 25;
const YOUTUBE_IMPORT_CONCURRENCY = 2;

interface YoutubeImportRow {
  url: string;
  status: 'queued' | 'active' | 'complete' | 'failed';
  title?: string;
  message?: string;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

function buildStages(hasBanner: boolean): UploadStage[] {
  const stages: UploadStage[] = [
    {
      id: 'presigned-url',
      label: 'Preparing direct S3 upload',
      detail: 'Request upload instructions from the API without sending audio bytes through NestJS.',
      status: 'waiting',
    },
    {
      id: 'source-upload',
      label: 'Uploading original WAV to S3',
      detail: 'The browser uploads the master file directly to private object storage.',
      status: 'waiting',
    },
  ];

  if (hasBanner) {
    stages.push({
      id: 'cover-upload',
      label: 'Uploading song banner',
      detail: 'The banner image is uploaded directly to S3 and linked to this track.',
      status: 'waiting',
    });
  }

  stages.push(
    {
      id: 'metadata',
      label: 'Creating track metadata',
      detail: 'Catalog fields are saved so the server can start processing the source object.',
      status: 'waiting',
    },
    {
      id: 'aac',
      label: 'Creating AAC delivery files',
      detail: 'The backend will generate 64, 128, 256, and 320 kbps M4A renditions.',
      status: 'waiting',
    },
    {
      id: 'validation',
      label: 'Validating encoded audio',
      detail: 'ffprobe and decode checks confirm playable files before they become active.',
      status: 'waiting',
    },
    {
      id: 'delivery-upload',
      label: 'Uploading AAC files to S3',
      detail: 'Versioned delivery assets are stored under the track audio folder.',
      status: 'waiting',
    },
    {
      id: 'ready',
      label: 'Publishing track',
      detail: 'The track is marked READY only after every required rendition succeeds.',
      status: 'waiting',
    },
  );

  return stages;
}

export function UploadPage() {
  const { reload } = useLibrary();
  const [mode, setMode] = useState<'file' | 'youtube'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [stages, setStages] = useState<UploadStage[]>(buildStages(false));
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: '',
    artist: '',
    album: '',
    genre: 'Electronic',
    language: '',
    releaseYear: '2026',
    trackNumber: '1',
  });

  const [youtubeUrlsText, setYoutubeUrlsText] = useState('');
  const [youtubeAuthorized, setYoutubeAuthorized] = useState(false);
  const [youtubeRows, setYoutubeRows] = useState<YoutubeImportRow[]>([]);
  const [youtubeBusy, setYoutubeBusy] = useState(false);

  const youtubeUrls = useMemo(() => {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const line of youtubeUrlsText.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        urls.push(trimmed);
      }
    }
    return urls.slice(0, MAX_YOUTUBE_URLS);
  }, [youtubeUrlsText]);

  useEffect(() => {
    if (!bannerFile) {
      setBannerPreview(null);
      return;
    }
    const url = URL.createObjectURL(bannerFile);
    setBannerPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [bannerFile]);

  const completedCount = stages.filter((stage) => stage.status === 'complete').length;
  const progress = useMemo(() => (completedCount / stages.length) * 100, [completedCount, stages.length]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] ?? null);
  };

  const handleBannerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file && !ACCEPTED_COVER_TYPES.has(file.type)) {
      setErrorMessage('Banner image must be a JPEG, PNG, or WEBP file');
      event.target.value = '';
      return;
    }
    setBannerFile(file);
  };

  const updateForm = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const setStageStatus = (stageId: string, status: UploadStage['status']) => {
    setStages((current) =>
      current.map((stage) => (stage.id === stageId ? { ...stage, status } : stage)),
    );
  };

  const resetPipeline = () => {
    setStages(buildStages(Boolean(bannerFile)));
    setUploadProgress(0);
    setErrorMessage(null);
  };

  const startUpload = async () => {
    if (!selectedFile) return;

    resetPipeline();
    setBusy(true);
    let activeStageId: string | null = null;

    const activateStage = (stageId: string) => {
      activeStageId = stageId;
      setStageStatus(stageId, 'active');
    };

    const completeStage = (stageId: string) => {
      setStageStatus(stageId, 'complete');
      if (activeStageId === stageId) {
        activeStageId = null;
      }
    };

    try {
      activateStage('presigned-url');
      const session = await createUploadSession({
        title: form.title,
        artist: form.artist,
        album: form.album || undefined,
        genre: form.genre || undefined,
        language: form.language || undefined,
        releaseYear: form.releaseYear ? Number(form.releaseYear) : undefined,
        trackNumber: form.trackNumber ? Number(form.trackNumber) : undefined,
        fileName: selectedFile.name,
        contentType: selectedFile.type || 'audio/wav',
        sizeBytes: selectedFile.size,
      });
      completeStage('presigned-url');

      activateStage('source-upload');
      await uploadFileToS3(
        session.upload.url,
        selectedFile,
        session.upload.headers,
        setUploadProgress,
      );
      completeStage('source-upload');

      if (bannerFile) {
        activateStage('cover-upload');
        const coverSession = await createCoverUploadSession(session.track.id, {
          fileName: bannerFile.name,
          contentType: bannerFile.type || 'image/jpeg',
          sizeBytes: bannerFile.size,
        });
        await uploadFileToS3(coverSession.upload.url, bannerFile, coverSession.upload.headers, () => undefined);
        completeStage('cover-upload');
      }

      completeStage('metadata');
      activateStage('aac');
      await processUploadedTrack(session.track.id);

      completeStage('aac');
      completeStage('validation');
      completeStage('delivery-upload');
      completeStage('ready');
      void reload();
    } catch (error) {
      if (activeStageId) {
        setStageStatus(activeStageId, 'failed');
      }
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const updateYoutubeRow = (index: number, patch: Partial<YoutubeImportRow>) => {
    setYoutubeRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const startYoutubeImport = async () => {
    if (youtubeUrls.length === 0 || !youtubeAuthorized) return;

    setErrorMessage(null);
    setYoutubeBusy(true);
    setYoutubeRows(youtubeUrls.map((url) => ({ url, status: 'queued' })));

    /**
     * Per-video metadata overrides only make sense when importing a single
     * link; a batch of URLs each get their title/artist from YouTube itself.
     */
    const singleOverride = youtubeUrls.length === 1;

    await runWithConcurrency(youtubeUrls, YOUTUBE_IMPORT_CONCURRENCY, async (url, index) => {
      updateYoutubeRow(index, { status: 'active' });
      try {
        const result = await importYoutubeTrack({
          url,
          authorizationConfirmed: true,
          title: singleOverride ? form.title || undefined : undefined,
          artist: singleOverride ? form.artist || undefined : undefined,
          album: singleOverride ? form.album || undefined : undefined,
          genre: singleOverride ? form.genre || undefined : undefined,
          language: singleOverride ? form.language || undefined : undefined,
          releaseYear: singleOverride && form.releaseYear ? Number(form.releaseYear) : undefined,
        });
        updateYoutubeRow(index, { status: 'complete', title: result.title });
        void reload();
      } catch (error) {
        updateYoutubeRow(index, {
          status: 'failed',
          message: error instanceof Error ? error.message : 'Import failed',
        });
      }
    });

    setYoutubeBusy(false);
  };

  return (
    <Box className="page upload-page">
      <Box className="page-heading-row">
        <Box>
          <Typography component="h1" className="page-title">
            Upload Songs
          </Typography>
          <Typography className="section-subtitle">
            {mode === 'file'
              ? 'Direct-to-S3 upload with backend audio preparation.'
              : 'Paste YouTube links and the backend downloads, transcodes, and prepares each song.'}
          </Typography>
        </Box>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_event, value: 'file' | 'youtube' | null) => value && setMode(value)}
          className="upload-mode-toggle"
        >
          <ToggleButton value="file">
            <UploadCloud size={16} />
            Upload file
          </ToggleButton>
          <ToggleButton value="youtube">
            <Youtube size={16} />
            Import from YouTube
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box className="upload-layout">
        <Box className="upload-form-panel">
          {mode === 'file' ? (
            <>
              <label className="dropzone">
                <input type="file" accept=".wav,audio/wav,audio/x-wav" onChange={handleFileChange} />
                <UploadCloud size={32} />
                <span>{selectedFile ? selectedFile.name : 'Choose a WAV master file'}</span>
                <small>WAV only · direct S3 upload flow</small>
              </label>

              <Box className="banner-dropzone-row">
                {bannerPreview ? (
                  <Box className="banner-preview">
                    <img src={bannerPreview} alt="Song banner preview" />
                    <button
                      type="button"
                      className="banner-remove"
                      onClick={() => setBannerFile(null)}
                      aria-label="Remove banner image"
                    >
                      <X size={14} />
                    </button>
                  </Box>
                ) : (
                  <label className="dropzone banner-dropzone">
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleBannerChange} />
                    <Image size={28} />
                    <span>Add a song banner</span>
                    <small>JPEG, PNG, or WEBP · optional</small>
                  </label>
                )}
              </Box>
            </>
          ) : (
            <>
              <label className="dropzone youtube-dropzone">
                <Link2 size={28} />
                <span>Paste one or more YouTube links, one per line</span>
                <small>
                  Up to {MAX_YOUTUBE_URLS} links · processed {YOUTUBE_IMPORT_CONCURRENCY} at a time
                </small>
              </label>
              <TextField
                multiline
                minRows={4}
                maxRows={8}
                placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...'}
                value={youtubeUrlsText}
                onChange={(event) => setYoutubeUrlsText(event.target.value)}
                className="youtube-url-field"
              />
              {youtubeUrls.length > 0 && (
                <Chip label={`${youtubeUrls.length} link${youtubeUrls.length === 1 ? '' : 's'} detected`} className="soft-chip" />
              )}
            </>
          )}

          <Box className="form-grid">
            <TextField label="Title" value={form.title} onChange={(event) => updateForm('title', event.target.value)} />
            <TextField label="Artist" value={form.artist} onChange={(event) => updateForm('artist', event.target.value)} />
            <TextField label="Album" value={form.album} onChange={(event) => updateForm('album', event.target.value)} />
            <TextField select label="Genre" value={form.genre} onChange={(event) => updateForm('genre', event.target.value)}>
              {GENRES.map((genre) => (
                <MenuItem key={genre} value={genre}>
                  {genre}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Language"
              value={form.language}
              onChange={(event) => updateForm('language', event.target.value)}
            >
              <MenuItem value="">Unspecified</MenuItem>
              {LANGUAGE_OPTIONS.map((option) => (
                <MenuItem key={option.code} value={option.code}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Release year"
              value={form.releaseYear}
              onChange={(event) => updateForm('releaseYear', event.target.value)}
            />
            {mode === 'file' && (
              <TextField
                label="Track number"
                value={form.trackNumber}
                onChange={(event) => updateForm('trackNumber', event.target.value)}
              />
            )}
          </Box>
          {mode === 'youtube' && youtubeUrls.length > 1 && (
            <Typography className="section-subtitle youtube-override-note">
              Title/artist/album fields above only apply when importing a single link. Each of these{' '}
              {youtubeUrls.length} songs will use its own YouTube title and channel name.
            </Typography>
          )}

          {mode === 'file' ? (
            <Button
              variant="contained"
              size="large"
              startIcon={<Cloud size={19} />}
              disabled={busy || !selectedFile || !form.title || !form.artist}
              onClick={startUpload}
            >
              {busy ? 'Uploading...' : 'Upload song'}
            </Button>
          ) : (
            <>
              <FormControlLabel
                className="youtube-auth-checkbox"
                control={
                  <Checkbox
                    checked={youtubeAuthorized}
                    onChange={(event) => setYoutubeAuthorized(event.target.checked)}
                  />
                }
                label="I confirm I have the rights to download and use this content."
              />
              <Button
                variant="contained"
                size="large"
                startIcon={<Youtube size={19} />}
                disabled={youtubeBusy || youtubeUrls.length === 0 || !youtubeAuthorized}
                onClick={startYoutubeImport}
              >
                {youtubeBusy
                  ? 'Importing...'
                  : `Import ${youtubeUrls.length || ''} song${youtubeUrls.length === 1 ? '' : 's'}`.trim()}
              </Button>
            </>
          )}
          {errorMessage && <Typography className="upload-error">{errorMessage}</Typography>}
        </Box>

        <Box className="status-panel">
          {mode === 'file' ? (
            <>
              <Box className="section-heading-row">
                <Box>
                  <Typography component="h2" className="section-title">
                    Processing status
                  </Typography>
                  <Typography className="section-subtitle">
                    Source upload progress: {uploadProgress}%
                  </Typography>
                </Box>
                <Chip label={`${completedCount}/${stages.length}`} className="soft-chip" />
              </Box>

              <LinearProgress variant="determinate" value={progress} className="upload-progress" />

              <Box className="stage-list">
                {stages.map((stage) => (
                  <Box key={stage.id} className={`stage-row ${stage.status}`}>
                    <Box className="stage-icon">
                      {stage.status === 'complete' ? (
                        <CheckCircle2 size={20} />
                      ) : stage.status === 'active' ? (
                        <Loader2 size={20} className="spin" />
                      ) : stage.id === 'source-upload' || stage.id === 'delivery-upload' ? (
                        <Cloud size={20} />
                      ) : stage.id === 'cover-upload' ? (
                        <Image size={20} />
                      ) : stage.id === 'validation' ? (
                        <ShieldCheck size={20} />
                      ) : (
                        <FileAudio2 size={20} />
                      )}
                    </Box>
                    <Box className="stage-copy">
                      <Typography className="stage-title">{stage.label}</Typography>
                      <Typography className="stage-detail">{stage.detail}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </>
          ) : (
            <>
              <Box className="section-heading-row">
                <Box>
                  <Typography component="h2" className="section-title">
                    Import status
                  </Typography>
                  <Typography className="section-subtitle">
                    {youtubeRows.length === 0
                      ? 'Paste links and start an import to see progress here.'
                      : `${youtubeRows.filter((row) => row.status === 'complete').length}/${youtubeRows.length} completed`}
                  </Typography>
                </Box>
                {youtubeRows.length > 0 && (
                  <Chip
                    label={`${youtubeRows.filter((row) => row.status === 'complete').length}/${youtubeRows.length}`}
                    className="soft-chip"
                  />
                )}
              </Box>

              <Box className="stage-list youtube-row-list">
                {youtubeRows.length === 0 ? (
                  <Typography className="section-subtitle youtube-empty-state">No imports yet.</Typography>
                ) : (
                  youtubeRows.map((row, index) => (
                    <Box key={`${row.url}-${index}`} className={`stage-row youtube-row ${row.status}`}>
                      <Box className="stage-icon">
                        {row.status === 'complete' ? (
                          <CheckCircle2 size={20} />
                        ) : row.status === 'active' ? (
                          <Loader2 size={20} className="spin" />
                        ) : row.status === 'failed' ? (
                          <AlertTriangle size={20} />
                        ) : (
                          <Youtube size={20} />
                        )}
                      </Box>
                      <Box className="stage-copy">
                        <Typography className="stage-title">{row.title ?? row.url}</Typography>
                        <Typography className="stage-detail">
                          {row.status === 'failed' ? row.message ?? 'Import failed' : row.title ? row.url : 'Waiting to start...'}
                        </Typography>
                      </Box>
                    </Box>
                  ))
                )}
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
