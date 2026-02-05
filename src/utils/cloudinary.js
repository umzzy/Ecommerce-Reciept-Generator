const { v2: cloudinary } = require("cloudinary");

const { cloudinary: cloudinaryConfig, receiptSignedUrlTtlSec } = require("../config/keys");

const isCloudinaryConfigured = () =>
  Boolean(
    cloudinaryConfig?.cloudName &&
      cloudinaryConfig?.apiKey &&
      cloudinaryConfig?.apiSecret,
  );

let configured = false;
const ensureConfigured = () => {
  if (configured) return;
  if (!isCloudinaryConfigured()) return;
  cloudinary.config({
    cloud_name: cloudinaryConfig.cloudName,
    api_key: cloudinaryConfig.apiKey,
    api_secret: cloudinaryConfig.apiSecret,
    secure: true,
  });
  configured = true;
};

const uploadPdfBuffer = async ({ buffer, publicId, folder }) => {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("uploadPdfBuffer expects a Buffer");
  }
  if (!publicId || typeof publicId !== "string") {
    throw new Error("uploadPdfBuffer expects publicId");
  }
  if (!isCloudinaryConfigured()) {
    const err = new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
    );
    err.code = "CLOUDINARY_NOT_CONFIGURED";
    throw err;
  }

  ensureConfigured();
  const resolvedPublicId = folder ? `${folder}/${publicId}` : publicId;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        format: "pdf",
        public_id: resolvedPublicId,
        overwrite: true,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          publicId: result.public_id,
          url: result.secure_url || result.url,
        });
      },
    );
    stream.end(buffer);
  });
};

module.exports = {
  isCloudinaryConfigured,
  uploadPdfBuffer,
  getSignedPdfDownloadUrl: ({ publicId, attachment, expiresAtSec }) => {
    if (!publicId || typeof publicId !== "string") {
      throw new Error("getSignedPdfDownloadUrl expects publicId");
    }
    if (!isCloudinaryConfigured()) {
      const err = new Error(
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
      );
      err.code = "CLOUDINARY_NOT_CONFIGURED";
      throw err;
    }

    ensureConfigured();

    const ttlSec = (() => {
      const value = Number(receiptSignedUrlTtlSec);
      if (Number.isFinite(value) && value > 0) return value;
      return 15 * 60;
    })();

    const nowSec = Math.floor(Date.now() / 1000);
    const resolvedExpiresAtSec =
      Number.isFinite(Number(expiresAtSec)) && Number(expiresAtSec) > nowSec
        ? Number(expiresAtSec)
        : nowSec + ttlSec;

    const normalizedPublicId = publicId.endsWith(".pdf")
      ? publicId
      : `${publicId}.pdf`;

    const url = cloudinary.utils.private_download_url(normalizedPublicId, "pdf", {
      resource_type: "raw",
      type: "upload",
      expires_at: resolvedExpiresAtSec,
      attachment: attachment === true,
    });

    return { url, expiresAtSec: resolvedExpiresAtSec, ttlSec };
  },
};
