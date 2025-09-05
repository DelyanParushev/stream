module.exports = {
    // OMDB API configuration (for IMDB ID lookups)
    OMDB_API_KEY: process.env.OMDB_API_KEY || 'a555ebd2',
    OMDB_BASE_URL: 'https://www.omdbapi.com',
    
    // 1337x configuration
    SCRAPER_BASE_URL: 'https://1337x.to',
    SCRAPER_SEARCH_URL: 'https://1337x.to/search',
    
    // Stremio addon configuration
    ADDON_NAME: '1337x',
    ADDON_VERSION: '1.0.0',
    ADDON_DESCRIPTION: 'Stream torrents from 1337x.to via magnet links',
    
    // Search limits and timeouts
    MAX_SEARCH_RESULTS: 20,
    REQUEST_TIMEOUT: 10000,
    CACHE_TTL: 3600, // 1 hour in seconds
    
    // Quality filters
    QUALITY_PREFERENCES: ['2160p', '1080p', '720p', '480p'],
    
    // Content types
    SUPPORTED_TYPES: ['movie', 'series'],
    
    // User agent for scraping
    USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};