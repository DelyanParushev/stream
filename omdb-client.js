const fetch = require('node-fetch');
const config = require('./config');

class OMDBClient {
    constructor(apiKey = config.OMDB_API_KEY) {
        this.apiKey = apiKey;
        this.baseUrl = config.OMDB_BASE_URL;
        this.cache = new Map(); // Simple in-memory cache
    }

    async makeRequest(params) {
        const url = new URL(this.baseUrl);
        
        // Add API key and parameters
        url.searchParams.append('apikey', this.apiKey);
        Object.entries(params).forEach(([key, value]) => {
            if (value) url.searchParams.append(key, value);
        });

        try {
            console.log(`OMDB request: ${url.toString()}`);
            const response = await fetch(url.toString(), {
                timeout: config.REQUEST_TIMEOUT
            });

            if (!response.ok) {
                throw new Error(`OMDB API error: ${response.status} - ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.Response === 'False') {
                throw new Error(`OMDB error: ${data.Error}`);
            }

            return data;
        } catch (error) {
            console.error('OMDB API request failed:', error);
            throw error;
        }
    }

    // Get movie/show details by IMDB ID
    async getByImdbId(imdbId) {
        // Check cache first
        if (this.cache.has(imdbId)) {
            console.log(`Found cached OMDB data for ${imdbId}`);
            return this.cache.get(imdbId);
        }

        try {
            const data = await this.makeRequest({ i: imdbId });
            
            // Cache the result
            this.cache.set(imdbId, data);
            
            return data;
        } catch (error) {
            console.error(`Failed to get OMDB data for ${imdbId}:`, error);
            return null;
        }
    }

    // Search for movies/shows by title
    async searchByTitle(title, year = null, type = null) {
        const cacheKey = `search_${title}_${year}_${type}`;
        
        if (this.cache.has(cacheKey)) {
            console.log(`Found cached search results for "${title}"`);
            return this.cache.get(cacheKey);
        }

        try {
            const params = { s: title };
            if (year) params.y = year;
            if (type) params.type = type; // movie, series, episode

            const data = await this.makeRequest(params);
            
            // Cache the result
            this.cache.set(cacheKey, data);
            
            return data;
        } catch (error) {
            console.error(`Failed to search OMDB for "${title}":`, error);
            return null;
        }
    }

    // Convert IMDB data to search query for 1337x
    formatForSearch(omdbData) {
        if (!omdbData) return null;

        const title = omdbData.Title;
        const year = omdbData.Year;
        const type = omdbData.Type;

        // Create search query
        let searchQuery = title;
        
        // Add year for movies to be more specific
        if (type === 'movie' && year && year !== 'N/A') {
            searchQuery += ` ${year}`;
        }

        // Clean up the title
        searchQuery = searchQuery
            .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
            .trim();

        return {
            searchQuery,
            title,
            year: year !== 'N/A' ? parseInt(year) : null,
            type,
            imdbRating: omdbData.imdbRating !== 'N/A' ? parseFloat(omdbData.imdbRating) : null
        };
    }

    // Validate API key
    async validateApiKey() {
        try {
            // Test with a known IMDB ID
            await this.makeRequest({ i: 'tt0111161' }); // Shawshank Redemption
            return true;
        } catch (error) {
            console.error('OMDB API key validation failed:', error);
            return false;
        }
    }
}

module.exports = OMDBClient;
