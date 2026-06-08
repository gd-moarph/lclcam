# LCLCam

Open-source local phone camera studio for OBS, streaming, video calls, tutorials, demos, and desk setups.

LCLCam lets you scan a QR code with your phone and use that phone camera as a live browser camera source on your desktop. It is designed for people who want extra camera angles on the same local network without cloud video processing, accounts, subscriptions, payments, or external auth services.

![LCLCam social preview](public/assets/lclcam-og.png)

## What it does

- Creates a local Studio dashboard at `/`
- Generates QR codes for phone pairing
- Streams phone camera video to the Studio preview using WebRTC
- Supports multiple phones/camera angles at the same time
- Provides a permanent OBS Browser Source URL per linked phone while the server is running
- Lets you rotate, frame, and adjust camera output live
- Includes brightness, contrast, saturation, and black-and-white controls
- Supports pause/resume while keeping the phone connected
- Tracks in-memory session history during the running process
- Includes OBS and video-call tutorial pages

## Screenshots and visual assets

### Streaming Angles

![Streaming angles](public/assets/streaming-angles.png)

### Calls and Chats

![Calls and chats](public/assets/calls-chats.png)

### Projects and Demos

![Projects and demos](public/assets/projects-demos.png)

## Requirements

- Node.js 20 or newer
- A desktop browser
- A phone browser
- Both devices on the same network for the intended low-latency local use case

## Run locally with secure phone access

The phone camera page must be opened from HTTPS. Local desktop HTTP is fine for preview, but mobile browsers usually block camera access on plain local-network HTTP addresses such as `http://192.168.x.x`.

For local use, run LCLCam on your computer and expose it through Cloudflare Tunnel. Temporary `trycloudflare.com` tunnels do not require a Cloudflare account.

### 1. Install app dependencies

```bash
npm install
```

### 2. Install Cloudflare Tunnel

Windows:

```powershell
winget install --id Cloudflare.cloudflared
```

macOS:

```bash
brew install cloudflared
```

Linux:

Install `cloudflared` using Cloudflare's package repository or direct binary for your distribution:

```text
https://developers.cloudflare.com/tunnel/downloads/
```

After installing, restart your terminal if the `cloudflared` command is not detected immediately.

### 3. Start LCLCam

Terminal 1:

```bash
npm start
```

### 4. Start the secure tunnel

Terminal 2:

```bash
cloudflared tunnel --url http://localhost:3000
```

Cloudflare Tunnel prints a temporary URL like:

```text
https://example-random-name.trycloudflare.com
```

Open that HTTPS URL on your desktop, then create the QR code from there. The QR code will use the same HTTPS tunnel URL, so the phone browser can access the camera without certificate errors.

The video stream is still WebRTC-based. The tunnel is mainly used to serve the app over HTTPS and handle pairing/signaling.

## Deploy to Railway or similar hosting

The local Cloudflare Tunnel steps are not needed when deploying to Railway or similar hosting.

Railway can provide a free generated HTTPS domain, and you can also attach your own custom domain with SSL. As long as the app is opened from an HTTPS domain, the phone browser can request camera access normally.

For hosted deployments, set:

```env
PORT=3000
PUBLIC_BASE_URL=https://your-domain.com
```

Use the Railway-generated HTTPS URL or your custom HTTPS domain as `PUBLIC_BASE_URL`.

No database or email service is required for this standalone version.

If you deploy publicly, the Studio is open to anyone who can access the URL. For private personal use, run locally, restrict access at the network level, or place the app behind your own reverse proxy/auth layer.

## OBS usage

1. Open the Studio dashboard.
2. Click `Create QR code`.
3. Scan the QR code on your phone.
4. Start the phone stream.
5. Copy the camera OBS URL from the camera tile.
6. In OBS, add a `Browser Source`.
7. Paste the camera URL.
8. Set the Browser Source resolution to match your phone output, for example `1920 x 1080` for 1080p landscape.

The copied OBS URL is a long secret URL. Anyone who has it can view that camera while the phone is online. Use `Regenerate OBS URL` if you think it leaked.

## Discord, Slack, Zoom, Meet, and similar apps

Most call apps cannot use a browser page as a camera directly. Use OBS as the bridge:

1. Add the LCLCam camera URL as an OBS Browser Source.
2. Start `OBS Virtual Camera`.
3. Select `OBS Virtual Camera` in your call app.

## Data and persistence

This standalone version stores camera records and session history in memory only. Restarting the server clears linked camera records, history, and OBS URL secrets.

That is intentional for this clean open-source build. If you want persistent saved cameras, add your own storage layer.

## Security notes

- Keep OBS camera URLs private.
- Do not expose this app publicly unless you understand that the Studio has no login.
- Use HTTPS for phone camera permissions on deployed versions.
- Prefer local network use for the lowest latency and simplest privacy model.

## License

Add your preferred open-source license before publishing the repository.
