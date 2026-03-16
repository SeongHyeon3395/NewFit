import { launchCamera, launchImageLibrary } from 'react-native-image-picker';

type PickedImage = {
  uri: string;
  fileName?: string;
  type?: string;
  base64?: string;
};

function tryGetCropPicker(): any | null {
  try {
    return require('react-native-image-crop-picker')?.default ?? require('react-native-image-crop-picker');
  } catch {
    return null;
  }
}

function toFileUri(uriOrPath: string) {
  if (!uriOrPath) return '';
  if (uriOrPath.startsWith('file://')) return uriOrPath;
  if (uriOrPath.startsWith('content://')) return uriOrPath;
  return `file://${uriOrPath}`;
}

function getFilenameFromPath(pathOrUri: string) {
  const raw = pathOrUri.split('?')[0];
  const parts = raw.split('/');
  return parts[parts.length - 1] || `photo_${Date.now()}.jpg`;
}

function pickFirstAsset(result: any): PickedImage | null {
  if (!result) return null;
  if (result.didCancel) return null;
  if (result.errorCode) {
    throw new Error(result.errorMessage || result.errorCode);
  }
  const asset = Array.isArray(result.assets) ? result.assets[0] : null;
  const uri = typeof asset?.uri === 'string' ? asset.uri.trim() : '';
  if (!uri) return null;

  return {
    uri,
    fileName: typeof asset?.fileName === 'string' ? asset.fileName : undefined,
    type: typeof asset?.type === 'string' ? asset.type : undefined,
    base64: typeof asset?.base64 === 'string' ? asset.base64 : undefined,
  };
}

export async function pickPhotoFromCamera(params?: {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  includeBase64?: boolean;
}): Promise<PickedImage | null> {
  const result = await launchCamera({
    mediaType: 'photo',
    saveToPhotos: false,
    ...(typeof params?.maxWidth === 'number' ? { maxWidth: params.maxWidth } : null),
    ...(typeof params?.maxHeight === 'number' ? { maxHeight: params.maxHeight } : null),
    quality: (params?.quality ?? 0.84) as any,
    includeBase64: Boolean(params?.includeBase64),
  });
  return pickFirstAsset(result);
}

export async function pickPhotoFromLibrary(params?: {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}): Promise<PickedImage | null> {
  // Prefer CropPicker on Android: it returns a real file path (cropper needs it).
  const CropPicker = tryGetCropPicker();
  if (CropPicker?.openPicker) {
    try {
      const picked = await CropPicker.openPicker({
        mediaType: 'photo',
        cropping: false,
        includeBase64: false,
        // Keep original resolution; apply max(1024) later at upload/analyze time.
      } as any);

      const path = typeof picked?.path === 'string' ? picked.path : '';
      if (!path) return null;
      return {
        uri: toFileUri(path),
        fileName: getFilenameFromPath(path),
        type: typeof picked?.mime === 'string' ? picked.mime : 'image/jpeg',
      };
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? '');
      if (msg.toLowerCase().includes('cancel')) return null;
      // Fallback to ImagePicker below
    }
  }

  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: 1,
    ...(typeof params?.maxWidth === 'number' ? { maxWidth: params.maxWidth } : null),
    ...(typeof params?.maxHeight === 'number' ? { maxHeight: params.maxHeight } : null),
    quality: (params?.quality ?? 0.84) as any,
    includeBase64: false,
  });
  return pickFirstAsset(result);
}

export async function pickAvatarFromLibrary(): Promise<PickedImage | null> {
  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: 1,
    maxWidth: 512,
    maxHeight: 512,
    quality: 0.9,
    includeBase64: true,
  });
  return pickFirstAsset(result);
}
