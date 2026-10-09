# Restore harness

Browser test for "restore a draft brings everything back": transcript fixture (WAV + SRT), mock translate, mock Centroid QC,
apply a fix, save the draft, reload, then restore four ways (same file uploaded again, no upload, media removed + Relink,
version-1 draft, cloud project on an empty browser). The backend API is mocked in `common.cjs`.

    npm run build && npx vite preview --port 4173 &
    CHROME_PATH=/path/to/chrome node e2e/restore/e2e.cjs     # needs `playwright` installed; run from this folder
