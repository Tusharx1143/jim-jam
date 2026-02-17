# 🚀 Deployment Guide - Render

This guide will help you deploy Jim-jam to Render in under 10 minutes!

## Prerequisites

- [x] GitHub repository (already set up!)
- [x] YouTube API Key
- [ ] Render account (free)

## Step-by-Step Deployment

### 1. Create a Render Account

1. Go to [render.com](https://render.com)
2. Click **"Get Started for Free"**
3. Sign up with your **GitHub account** (easiest option)

### 2. Deploy Your App

#### Option A: One-Click Deploy with render.yaml (Recommended)

1. In Render Dashboard, click **"New +"** → **"Blueprint"**
2. Connect your GitHub repository: `Tusharx1143/jim-jam`
3. Select the **UI branch**
4. Render will automatically detect the `render.yaml` file
5. Click **"Apply"**

#### Option B: Manual Setup

1. In Render Dashboard, click **"New +"** → **"Web Service"**
2. Connect your GitHub repository: `Tusharx1143/jim-jam`
3. Configure the service:
   - **Name:** `jim-jam`
   - **Branch:** `UI`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`

### 3. Set Environment Variables

1. In your web service settings, go to **"Environment"** tab
2. Add the following environment variable:
   - **Key:** `YOUTUBE_API_KEY`
   - **Value:** `[Your YouTube API Key]`
3. Click **"Save Changes"**

### 4. Deploy!

1. Render will automatically deploy your app
2. Wait 2-5 minutes for the build to complete
3. Your app will be live at: `https://jim-jam-[random].onrender.com`

### 5. Test with Multiple Users

1. Open the deployed URL in your browser
2. Create a room
3. Copy the room link
4. Open it in **multiple devices/browsers**:
   - Your phone
   - Incognito window
   - Friend's device
5. Play a song and verify sync! 🎵

## Important Notes

### Free Tier Limitations

- ✅ Unlimited bandwidth
- ✅ Auto-deploy on git push
- ✅ Free SSL certificate
- ⚠️ **App spins down after 15 minutes of inactivity**
  - First request after inactivity takes ~30 seconds to wake up
  - This is normal for free tier!
  - Upgrade to paid tier ($7/month) for always-on

### Custom Domain (Optional)

1. Go to **Settings** → **Custom Domain**
2. Add your domain (e.g., `jamwith.me`)
3. Update DNS records as instructed

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `YOUTUBE_API_KEY` | Yes | YouTube Data API v3 key |
| `PORT` | No | Auto-set by Render |
| `NODE_ENV` | No | Auto-set to `production` |

## Troubleshooting

### Build Failed
- Check build logs in Render dashboard
- Ensure `package.json` has all dependencies
- Verify Node.js version compatibility

### App Crashes on Start
- Check **Logs** tab in Render dashboard
- Ensure `YOUTUBE_API_KEY` is set correctly
- Verify environment variables are saved

### Socket.IO Connection Issues
- Render fully supports WebSocket/Socket.IO
- If issues persist, check browser console for errors
- Ensure you're using HTTPS (not HTTP)

### App is Slow to Load
- Free tier apps sleep after 15 min inactivity
- First request wakes the app (~30 sec delay)
- Consider upgrading to paid tier for 24/7 uptime

## Monitoring Your App

- **Logs:** Real-time logs in Render dashboard
- **Metrics:** CPU/Memory usage (paid tier)
- **Events:** Deploy history and status

## Updating Your App

1. Push changes to GitHub (UI branch)
2. Render automatically detects and deploys
3. No manual steps needed! 🎉

## Next Steps After Deployment

- [ ] Test with 3+ users in different locations
- [ ] Share the link with friends
- [ ] Monitor performance in Render dashboard
- [ ] Consider custom domain
- [ ] Set up health check monitoring

---

Need help? Check [Render Docs](https://render.com/docs) or open an issue on GitHub!
