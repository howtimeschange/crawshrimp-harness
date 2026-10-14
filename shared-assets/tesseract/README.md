# Shared Tesseract Assets

Release packaging copies one adapter's `vendor/tesseract` directory here as
`Resources/python-scripts/shared-assets/tesseract`.

Runtime adapter asset URLs stay compatible with the old shape:
`/adapter-assets/<adapter-id>/vendor/tesseract/...`.

The backend resolves those URLs from the adapter directory first. If a packaged
adapter no longer contains `vendor/tesseract`, the backend falls back to this
shared directory. This keeps independently exported adapters and customized
adapter packages working without being overridden by shared assets.
