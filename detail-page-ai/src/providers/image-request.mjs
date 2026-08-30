export function buildImageRequest({ prompt, imageRole, promptContext, referenceAssets = [] }) {
  if (!prompt || !imageRole || !promptContext?.plan) throw new Error('INVALID_IMAGE_REQUEST');

  return Object.freeze({
    prompt,
    imageRole,
    quality: promptContext.plan.imageQuality,
    maxRetries: promptContext.plan.maxImageRetries,
    referenceAssetIds: referenceAssets.map((asset) => asset.id),
    metadata: {
      planImageCount: promptContext.plan.totalImageCount,
      promptPath: promptContext.promptPath,
    },
  });
}
