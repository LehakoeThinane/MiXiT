import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Phone photos are often 3–5 MB. Resizing to 1080px wide at ~70% JPEG quality
// keeps them sharp on any phone screen at roughly 150–300 KB — less data for the
// sender to upload and for everyone who views them.
const MAX_WIDTH = 1080;
const QUALITY = 0.7;

export async function compressImage(uri: string, width?: number): Promise<{ uri: string; mimeType: 'image/jpeg' }> {
  const context = ImageManipulator.manipulate(uri);
  if (!width || width > MAX_WIDTH) context.resize({ width: MAX_WIDTH });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
  return { uri: result.uri, mimeType: 'image/jpeg' };
}
