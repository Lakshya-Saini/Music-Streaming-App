import { Box, Button, TextField, Typography } from '@mui/material';
import { ShieldCheck } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { useAuth } from '../state/AuthContext';

export function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [adminMode, setAdminMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  const handleGoogleCredential = async (idToken: string) => {
    setError(null);
    try {
      await loginWithGoogle(idToken);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in with Google.');
    }
  };

  const handleAdminSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box className="page auth-page">
      <Box className="auth-card">
        <Box className="empty-state-icon">
          <ShieldCheck size={24} />
        </Box>
        <Typography component="h1" className="page-title">
          Welcome back
        </Typography>
        <Typography className="section-subtitle">
          Sign in with Google to play songs and manage your playlists.
        </Typography>

        {!adminMode && (
          <Box className="google-signin-wrap">
            <GoogleSignInButton onCredential={handleGoogleCredential} onError={setError} />
          </Box>
        )}

        {adminMode && (
          <Box component="form" className="auth-admin-form" onSubmit={handleAdminSubmit}>
            <TextField
              type="email"
              label="Admin email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
              fullWidth
              className="auth-field"
            />
            <TextField
              type="password"
              label="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              fullWidth
              className="auth-field"
            />
            <Button type="submit" variant="contained" disabled={submitting} fullWidth className="auth-submit">
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </Box>
        )}

        {error && <Typography className="auth-error">{error}</Typography>}

        <Typography className="auth-switch">
          {adminMode ? (
            <button type="button" className="auth-link-btn" onClick={() => setAdminMode(false)}>
              Back to Google sign-in
            </button>
          ) : (
            <button type="button" className="auth-link-btn" onClick={() => setAdminMode(true)}>
              Sign in as admin instead
            </button>
          )}
        </Typography>
      </Box>
    </Box>
  );
}
