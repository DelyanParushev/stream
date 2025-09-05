# stream Addon

## Prerequisites

1. **Node.js**: Version 14 or higher
2. **Stremio**: Desktop, web, or mobile app
3. **BitTorrent Client**: For streaming magnet links (Stremio handles this automatically)

## Installation

1. **Clone or download this repository**

2. **Install dependencies:**
   ```bash
   cd "path/to/addon"
   npm install
   ```

## Usage

1. **Start the addon:**
   ```bash
   npm start
   ```
   The addon will be running at `http://localhost:3000`

2. **Add to Stremio:**
   - Open Stremio
   - Go to Settings → Add-ons
   - Paste this URL: `http://localhost:3000/manifest.json`
   - Click Install

3. **Watch content:**
   - Search for movies or TV shows in Stremio
   - The addon will appear as a source option
   - Click on streams provided by "Torbox 1337x Addon"

## Testing

Test the addon components before using:

```bash
# Test everything
npm test

# Test only the scraper
npm run test:scraper

# Test only Torbox integration
npm run test:torbox

# Test configuration
npm run test:config
```

## Configuration

Edit `config.js` to customize:

- `MAX_SEARCH_RESULTS`: Maximum torrents to find per search
- `QUALITY_PREFERENCES`: Preferred video quality order
- `REQUEST_TIMEOUT`: Timeout for web requests
- `CACHE_TTL`: How long to cache search results

## How It Works

1. **Search**: When you select a movie/show in Stremio, the addon searches 1337x.to
2. **Scrape**: Extracts torrent information including magnet links
3. **Add to Torbox**: Sends the magnet link to your Torbox account
4. **Stream**: Torbox processes the torrent and provides a direct streaming link
5. **Watch**: Stremio plays the stream from Torbox

## File Structure

```
stremio-torbox-addon/
├── config.js          # Configuration settings
├── index.js           # Main addon server
├── torrent-scraper.js  # 1337x.to scraping logic
├── torbox-client.js    # Torbox API integration
├── test.js            # Testing utilities
├── package.json       # Project dependencies
└── README.md          # This file
```

## Troubleshooting

### Common Issues

1. **"API key validation failed"**
   - Check that your Torbox API key is correct
   - Ensure your Torbox subscription is active

2. **"No torrents found"**
   - Try different search terms
   - Check if 1337x.to is accessible from your location
   - Consider using a VPN if the site is blocked

3. **"Streams not appearing in Stremio"**
   - Ensure the addon URL is correctly added to Stremio
   - Check that the addon server is running
   - Look at console output for errors

4. **"Streams won't play"**
   - Check your Torbox account has sufficient storage
   - Ensure the torrent is fully processed in Torbox
   - Try a different torrent

### Debug Mode

Run with debug output:
```bash
DEBUG=true npm start
```

### Logs

Check the console output for detailed information about:
- Search queries and results
- Torbox API responses
- Stream creation process

## Legal Notice

⚠️ **Important**: This addon is for educational purposes. Users are responsible for complying with their local laws regarding torrenting and streaming content. The addon developers do not host, distribute, or endorse any copyrighted content.

- Only use with content you have legal rights to access
- Respect copyright laws in your jurisdiction
- Use a VPN if required in your location

## Support

If you encounter issues:

1. Run the test suite to identify problems
2. Check your Torbox account status and API key
3. Ensure 1337x.to is accessible
4. Review the console logs for error messages

## Contributing

Feel free to submit issues and enhancement requests!

## License


ISC License - Use at your own risk and responsibility.
