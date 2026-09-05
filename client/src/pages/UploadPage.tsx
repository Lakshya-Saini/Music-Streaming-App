import { Box, Button, Chip, LinearProgress, MenuItem, TextField, Typography } from '@mui/material';
import { CheckCircle2, Cloud, FileAudio2, Image, Loader2, ShieldCheck, UploadCloud, X } from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import {
  createCoverUploadSession,
  createUploadSession,
  processUploadedTrack,
  uploadFileToS3,
} from '../api/tracks';
import { useLibrary } from '../state/LibraryContext';
import { UploadStage } from '../types';
import { LANGUAGE_OPTIONS } from '../utils/languages';

const GENRES = ['Electronic', 'Indie', 'Alternative', 'Acoustic', 'Pop', 'Rock'];
const ACCEPTED_COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

  return (
    <Box className="page upload-page">
      <Box className="page-heading-row">
        <Box>
          <Typography component="h1" className="page-title">
            Upload Songs
          </Typography>
          <Typography className="section-subtitle">
            Direct-to-S3 upload with backend audio preparation.
          </Typography>
        </Box>
      </Box>

      <Box className="upload-layout">
        <Box className="upload-form-panel">
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
            <TextField
              label="Track number"
              value={form.trackNumber}
              onChange={(event) => updateForm('trackNumber', event.target.value)}
            />
          </Box>

          <Button
            variant="contained"
            size="large"
            startIcon={<Cloud size={19} />}
            disabled={busy || !selectedFile || !form.title || !form.artist}
            onClick={startUpload}
          >
            {busy ? 'Uploading...' : 'Upload song'}
          </Button>
          {errorMessage && <Typography className="upload-error">{errorMessage}</Typography>}
        </Box>

        <Box className="status-panel">
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
        </Box>
      </Box>
    </Box>
  );
}
