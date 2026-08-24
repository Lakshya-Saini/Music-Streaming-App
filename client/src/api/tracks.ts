interface UploadSessionRequest {
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  releaseYear?: number;
  trackNumber?: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

interface UploadSessionResponse {
  track: {
    id: string;
  };
  upload: {
    method: 'PUT';
    url: string;
    headers: Record<string, string>;
  };
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export async function createUploadSession(
  payload: UploadSessionRequest,
): Promise<UploadSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/tracks/upload-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<UploadSessionResponse>;
}

export function uploadFileToS3(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);

    Object.entries(headers).forEach(([key, value]) => {
      request.setRequestHeader(key, value);
    });

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(
        new Error(
          `S3 upload failed with status ${request.status}. Check the bucket CORS policy, object permissions, and that the request Content-Type matches the presigned URL.`,
        ),
      );
    };

    request.onerror = () =>
      reject(
        new Error(
          'S3 upload failed before S3 returned a response. This is commonly caused by missing S3 CORS rules for http://localhost:5173.',
        ),
      );
    request.send(file);
  });
}

export async function processUploadedTrack(trackId: string): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}/tracks/${trackId}/process`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json() as Promise<unknown>;
}
