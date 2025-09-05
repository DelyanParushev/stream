const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('./config');

class TorrentScraper {
    constructor() {
        this.baseUrl = config.SCRAPER_BASE_URL;
        this.searchUrl = config.SCRAPER_SEARCH_URL;
        this.headers = {
            'User-Agent': config.USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': 'https://1337x.to/',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'DNT': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
        };
    }

    async makeRequest(url) {
        try {
            const response = await fetch(url, {
                headers: this.headers,
                timeout: config.REQUEST_TIMEOUT
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.text();
        } catch (error) {
            console.error('Request failed:', error);
            throw error;
        }
    }

    // Search for torrents by query
    async searchTorrents(query, category = '') {
        try {
            // Clean and format search query
            const cleanQuery = query.replace(/[^\w\s-]/g, '').trim();
            let searchUrl = `${this.searchUrl}/${encodeURIComponent(cleanQuery)}/1/`;
            
            if (category) {
                searchUrl = `${this.baseUrl}/category-search/${encodeURIComponent(cleanQuery)}/${category}/1/`;
            }

            console.log(`Searching: ${searchUrl}`);
            const html = await this.makeRequest(searchUrl);
            const $ = cheerio.load(html);

            const torrents = [];
            const torrentRows = $('.table-list tbody tr');

            for (let i = 0; i < Math.min(torrentRows.length, config.MAX_SEARCH_RESULTS); i++) {
                const row = torrentRows.eq(i);
                const torrent = await this.parseTorrentRow($, row);
                if (torrent) {
                    torrents.push(torrent);
                }
            }

            return torrents;
        } catch (error) {
            console.error('Search failed:', error);
            return [];
        }
    }

    // Parse individual torrent row from search results
    async parseTorrentRow($, row) {
        try {
            const nameCell = row.find('.coll-1');
            const seedersCell = row.find('.coll-2');
            const leechersCell = row.find('.coll-3');
            const sizeCell = row.find('.coll-4');
            const uploaderCell = row.find('.coll-5');

            if (!nameCell.length) return null;

            const nameLink = nameCell.find('a').eq(1);
            const title = nameLink.text().trim();
            const detailPath = nameLink.attr('href');
            
            if (!title || !detailPath) return null;

            const detailUrl = `${this.baseUrl}${detailPath}`;
            const seeders = parseInt(seedersCell.text().trim()) || 0;
            const leechers = parseInt(leechersCell.text().trim()) || 0;
            const size = sizeCell.text().trim();
            const uploader = uploaderCell.find('a').text().trim();

            // Extract quality from title
            const quality = this.extractQuality(title);
            
            return {
                title,
                detailUrl,
                seeders,
                leechers,
                size,
                uploader,
                quality,
                score: this.calculateScore(seeders, leechers, quality)
            };
        } catch (error) {
            console.error('Failed to parse torrent row:', error);
            return null;
        }
    }

    // Get magnet link from torrent detail page
    async getMagnetLink(detailUrl) {
        try {
            console.log(`Getting magnet link from: ${detailUrl}`);
            const html = await this.makeRequest(detailUrl);
            const $ = cheerio.load(html);

            // Find magnet link
            const magnetLink = $('a[href^="magnet:"]').first();
            if (magnetLink.length) {
                return magnetLink.attr('href');
            }

            // Alternative selectors
            const magnetButton = $('.magnet-download a, .btn-magnet, a:contains("MAGNET")').first();
            if (magnetButton.length) {
                const href = magnetButton.attr('href');
                if (href && href.startsWith('magnet:')) {
                    return href;
                }
            }

            throw new Error('Magnet link not found');
        } catch (error) {
            console.error('Failed to get magnet link:', error);
            return null;
        }
    }

    // Extract quality information from title
    extractQuality(title) {
        const titleUpper = title.toUpperCase();
        
        // Check for various quality indicators
        if (titleUpper.includes('2160P') || titleUpper.includes('4K')) return '2160p';
        if (titleUpper.includes('1080P')) return '1080p';
        if (titleUpper.includes('720P')) return '720p';
        if (titleUpper.includes('480P')) return '480p';
        if (titleUpper.includes('HDTV') || titleUpper.includes('HD')) return '720p';
        if (titleUpper.includes('CAM') || titleUpper.includes('TS') || titleUpper.includes('TC')) return 'CAM';
        
        return 'Unknown';
    }

    // Calculate torrent score based on various factors
    calculateScore(seeders, leechers, quality) {
        let score = seeders * 2 + leechers;
        
        // Quality bonus
        const qualityBonus = {
            '2160p': 1000,
            '1080p': 500,
            '720p': 200,
            '480p': 100,
            'CAM': -500
        };
        
        score += qualityBonus[quality] || 0;
        
        return score;
    }

    // Search for movies specifically
    async searchMovies(query, year = null) {
        let searchQuery = query;
        if (year) {
            searchQuery += ` ${year}`;
        }
        
        return await this.searchTorrents(searchQuery, 'Movies');
    }

    // Search for TV shows specifically
    async searchTVShows(query, season = null, episode = null) {
        let searchQuery = query;
        if (season && episode) {
            searchQuery += ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
        } else if (season) {
            searchQuery += ` Season ${season}`;
        }
        
        return await this.searchTorrents(searchQuery, 'TV');
    }

    // Get complete torrent info including magnet link
    async getTorrentInfo(torrent) {
        try {
            const magnetLink = await this.getMagnetLink(torrent.detailUrl);
            return {
                ...torrent,
                magnet: magnetLink
            };
        } catch (error) {
            console.error('Failed to get complete torrent info:', error);
            return null;
        }
    }

    // Search and get complete torrents with magnet links
    async searchAndGetComplete(query, type = 'movie', year = null, season = null, episode = null) {
        try {
            let torrents = [];
            
            if (type === 'movie') {
                torrents = await this.searchMovies(query, year);
            } else if (type === 'series') {
                torrents = await this.searchTVShows(query, season, episode);
            } else {
                torrents = await this.searchTorrents(query);
            }

            // Sort by score (best first)
            torrents.sort((a, b) => b.score - a.score);

            // Get magnet links for top torrents
            const completeTorrents = [];
            for (const torrent of torrents.slice(0, 10)) { // Limit to top 10
                const completeTorrent = await this.getTorrentInfo(torrent);
                if (completeTorrent && completeTorrent.magnet) {
                    completeTorrents.push(completeTorrent);
                }
            }

            return completeTorrents;
        } catch (error) {
            console.error('Search and complete failed:', error);
            return [];
        }
    }
}

module.exports = TorrentScraper;