# Creation 3D

A small website that makes "Creation of Adam" style clips: two hands point at your media while it spins in 3D at a constant speed.

## How to use

1. Click **Attach media** or drop an image or video onto the stage.
2. The media appears between the hands as a 3D object. Transparent PNG/SVG logos are extruded along their outline; photos and videos become a solid slab.
3. Pick a quality from **144p** to **4K**. It applies to the preview and to both downloads.
4. Download the result: **MP4** (about 10 s, with the original soundtrack) or **GIF** (one seamless turn, no sound).

The soundtrack plays in the preview once media is attached; the speaker button in the corner mutes it. An attached video's own sound is not used.

Everything runs in the browser. Files never leave your computer.

## Publish on GitHub Pages

1. Create a new repository on GitHub, for example `creation-3d`.
2. Click **uploading an existing file** and drag in **everything in this folder**: `index.html`, `README.md` and the `assets`, `css` and `js` folders. Click **Commit changes**.
3. Open **Settings → Pages**, set **Source** to **Deploy from a branch**, pick branch `main` and folder `/ (root)`, then click **Save**.
4. After a minute or two the site is live at `https://<your-username>.github.io/<repository-name>/`.

## Run locally

Just double-click `index.html`. The hands (`js/hands.js`) and the soundtrack (`js/sound.js`) are built in, so no server is needed.

## Settings

At the top of `js/app.js`:

- `PERIOD`: seconds per full turn
- `MEDIA_SIZE`: size of the object in the middle
- `QUALITIES`: the sizes offered in the quality menu
- `MP4_FPS`, `GIF_FPS`: frame rates

## Requirements

Chrome or Edge (MP4 export uses WebCodecs). An internet connection is needed: three.js, mp4-muxer and gifenc load from a CDN.

## Credits

The hands are from Michelangelo's *The Creation of Adam* (public domain).
