import {
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { CheckCircle2, Cloud, FileAudio2, Home, Loader2, Moon, Music2, ShieldCheck, Sun, UploadCloud } from 'lucide-react';
import { ChangeEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppMode } from '../App';
import { UploadStage } from '../types';

const initialStages: UploadStage[] = [
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
];

interface UploadPageProps {
  mode: AppMode;
  onToggleMode: () => void;
}

export function UploadPage({ mode, onToggleMode }: UploadPageProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [stages, setStages] = useState<UploadStage[]>(initialStages);
  const [form, setForm] = useState({
    title: '',
    artist: '',
    album: '',
    genre: 'Electronic',
    releaseYear: '2026',
    trackNumber: '1',
  });

  const completedCount = stages.filter((stage) => stage.status === 'complete').length;
  const progress = useMemo(() => (completedCount / stages.length) * 100, [completedCount, stages.length]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] ?? null);
  };

  const updateForm = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const previewPipeline = () => {
    setStages((current) =>
      current.map((stage, index) => ({
        ...stage,
        status: index === 0 ? 'active' : 'waiting',
      })),
    );

    initialStages.forEach((_, index) => {
      window.setTimeout(() => {
        setStages((current) =>
          current.map((stage, stageIndex) => {
            if (stageIndex < index) return { ...stage, status: 'complete' };
            if (stageIndex === index) return { ...stage, status: 'active' };
            return { ...stage, status: 'waiting' };
          }),
        );
      }, index * 520);

      window.setTimeout(() => {
        setStages((current) =>
          current.map((stage, stageIndex) =>
            stageIndex <= index ? { ...stage, status: 'complete' } : stage,
          ),
        );
      }, index * 520 + 420);
    });
  };

  return (
    <Box className="upload-page">
      <Box className="upload-topbar">
        <Box className="brand-lockup">
          <Box className="brand-mark">
            <Music2 size={22} />
          </Box>
          <Typography component="h1" className="brand-name">
            Sonora Upload
          </Typography>
        </Box>
        <Box className="header-actions">
          <Button component={Link} to="/" variant="outlined" startIcon={<Home size={18} />}>
            Home
          </Button>
          <Tooltip title={mode === 'dark' ? 'Use light mode' : 'Use dark mode'}>
            <IconButton className="theme-toggle" onClick={onToggleMode} aria-label="Toggle dark mode">
              {mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box component="main" className="upload-layout">
        <Box className="upload-form-panel">
          <Box>
            <Typography component="h2" className="section-title">
              Add a song
            </Typography>
            <Typography className="section-subtitle">
              UI preview for direct-to-S3 upload and backend audio preparation.
            </Typography>
          </Box>

          <label className="dropzone">
            <input type="file" accept=".wav,audio/wav,audio/x-wav" onChange={handleFileChange} />
            <UploadCloud size={32} />
            <span>{selectedFile ? selectedFile.name : 'Choose a WAV master file'}</span>
            <small>WAV only · direct S3 upload flow</small>
          </label>

          <Box className="form-grid">
            <TextField label="Title" value={form.title} onChange={(event) => updateForm('title', event.target.value)} />
            <TextField label="Artist" value={form.artist} onChange={(event) => updateForm('artist', event.target.value)} />
            <TextField label="Album" value={form.album} onChange={(event) => updateForm('album', event.target.value)} />
            <TextField select label="Genre" value={form.genre} onChange={(event) => updateForm('genre', event.target.value)}>
              {['Electronic', 'Indie', 'Alternative', 'Acoustic', 'Pop', 'Rock'].map((genre) => (
                <MenuItem key={genre} value={genre}>
                  {genre}
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
            disabled={!selectedFile || !form.title || !form.artist}
            onClick={previewPipeline}
          >
            Preview upload pipeline
          </Button>
        </Box>

        <Box className="status-panel">
          <Box className="section-heading-row">
            <Box>
              <Typography component="h2" className="section-title">
                Processing status
              </Typography>
              <Typography className="section-subtitle">Each step will be wired to backend events later.</Typography>
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
                  ) : stage.id === 'validation' ? (
                    <ShieldCheck size={20} />
                  ) : (
                    <FileAudio2 size={20} />
                  )}
                </Box>
                <Box>
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
