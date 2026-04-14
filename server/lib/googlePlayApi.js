import { google } from 'googleapis';
import fs from 'fs';

export function createClient(serviceAccountJson) {
  const credentials = typeof serviceAccountJson === 'string'
    ? JSON.parse(serviceAccountJson)
    : serviceAccountJson;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  return google.androidpublisher({ version: 'v3', auth });
}

export async function createEdit(client, packageName) {
  const res = await client.edits.insert({ packageName });
  return res.data.id;
}

export async function uploadBundle(client, packageName, editId, aabFilePath) {
  const fileSize = fs.statSync(aabFilePath).size;
  const res = await client.edits.bundles.upload({
    packageName,
    editId,
    media: {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(aabFilePath),
    },
  }, {
    onUploadProgress: (evt) => {
      // Progress callback can be wired externally if needed
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return res.data.versionCode;
}

export async function updateTrack(client, packageName, editId, track, versionCode, releaseNotes) {
  const releases = [{
    versionCodes: [String(versionCode)],
    status: track === 'production' ? 'completed' : 'completed',
  }];

  if (releaseNotes) {
    releases[0].releaseNotes = [{ language: 'ko-KR', text: releaseNotes }];
  }

  await client.edits.tracks.update({
    packageName,
    editId,
    track,
    requestBody: { track, releases },
  });
}

export async function updateListing(client, packageName, editId, language, { title, shortDescription, fullDescription }) {
  await client.edits.listings.update({
    packageName,
    editId,
    language,
    requestBody: {
      language,
      title: title || undefined,
      shortDescription: shortDescription || undefined,
      fullDescription: fullDescription || undefined,
    },
  });
}

export async function commitEdit(client, packageName, editId) {
  await client.edits.commit({ packageName, editId });
}

export async function deleteEdit(client, packageName, editId) {
  try {
    await client.edits.delete({ packageName, editId });
  } catch {
    // Best effort cleanup — edit may have expired
  }
}

/**
 * Get current release status for a track.
 * Returns the latest release's status and version codes.
 */
export async function getTrackStatus(client, packageName, track) {
  const editId = await createEdit(client, packageName);
  try {
    const res = await client.edits.tracks.get({ packageName, editId, track });
    const releases = res.data.releases || [];
    const latest = releases[0];
    await deleteEdit(client, packageName, editId);
    if (!latest) return null;
    return {
      track: res.data.track,
      status: latest.status, // completed, inProgress, draft, halted
      versionCodes: latest.versionCodes || [],
      name: latest.name || '',
      releaseNotes: latest.releaseNotes || [],
    };
  } catch (err) {
    await deleteEdit(client, packageName, editId);
    throw err;
  }
}
