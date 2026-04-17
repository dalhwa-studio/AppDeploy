import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const KEYS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.appdeploy_keys');

export function encrypt(plainText, encryptionKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return {
    encrypted: encrypted + ':' + authTag,
    iv: iv.toString('hex'),
  };
}

export function decrypt(encryptedData, ivHex, encryptionKey) {
  const [encrypted, authTag] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function saveCredential({ storeType, fileName, fileContent, metadata }, encryptionKey) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const { encrypted, iv } = encrypt(fileContent, encryptionKey);
  const credentialId = crypto.randomUUID();
  const credPath = path.join(KEYS_DIR, `${credentialId}.enc`);

  fs.writeFileSync(credPath, JSON.stringify({
    id: credentialId,
    storeType,
    fileName,
    encrypted,
    iv,
    metadata: metadata || {},
    createdAt: new Date().toISOString(),
  }));

  return credentialId;
}

export function loadCredential(credentialId, encryptionKey) {
  const credPath = path.join(KEYS_DIR, `${credentialId}.enc`);
  if (!fs.existsSync(credPath)) {
    throw new Error(`자격증명을 찾을 수 없습니다: ${credentialId}`);
  }
  const data = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  return decrypt(data.encrypted, data.iv, encryptionKey);
}

export function findCredentialByType(storeType) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const files = fs.readdirSync(KEYS_DIR).filter(f => f.endsWith('.enc'));
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(KEYS_DIR, file), 'utf-8'));
    if (data.storeType === storeType) {
      return { id: data.id, fileName: data.fileName, metadata: data.metadata, createdAt: data.createdAt };
    }
  }
  return null;
}

/**
 * Patch the metadata of an existing credential without re-encrypting the key.
 * Used to update user-editable config (e.g. the model to use) without requiring
 * the user to re-enter their API key.
 */
export function updateCredentialMetadata(credentialId, patch) {
  const credPath = path.join(KEYS_DIR, `${credentialId}.enc`);
  if (!fs.existsSync(credPath)) {
    throw new Error(`자격증명을 찾을 수 없습니다: ${credentialId}`);
  }
  const data = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  data.metadata = { ...(data.metadata || {}), ...patch };
  fs.writeFileSync(credPath, JSON.stringify(data));
  return data.metadata;
}
