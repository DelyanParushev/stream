const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const TorrentScraper = require('./torrent-scraper');
const OMDBClient = require('./omdb-client');
const config = require('./config');

// Initialize scraper, clients
const scraper = new TorrentScraper();
const omdbClient = new OMDBClient();

// Cache for storing results temporarily
const cache = new Map();

// Addon manifest
const manifest = {
    id: '1337x.magnet.addon',
    version: config.ADDON_VERSION,
    name: config.ADDON_NAME,
    description: config.ADDON_DESCRIPTION,
    logo: 'https://raw.githubusercontent.com/stremio/stremio-addon-sdk/master/docs/logo.png',
    resources: ['stream'],
    types: config.SUPPORTED_TYPES,
    idPrefixes: ['tt', 'kitsu'],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
    try {
        console.log(`Stream request - Type: ${type}, ID: ${id}`);
        
        // Check cache first
        const cacheKey = `${type}:${id}`;
        if (cache.has(cacheKey)) {
            const cached = cache.get(cacheKey);
            if (Date.now() - cached.timestamp < config.CACHE_TTL * 1000) {
                console.log('Returning cached result');
                return cached.data;
            }
        }

        // Extract info from ID
        const parseResult = await parseStreamId(id);
        const { searchQuery, year, season, episode, searchVariations, isWWE, isTV } = parseResult;
        
        if (!searchQuery) {
            console.log('No search query extracted from ID');
            return { streams: [] };
        }

        console.log(`Searching for: ${searchQuery}`);
        
        // For WWE content, try multiple search variations
        let torrents = [];
        const isWWEContent = isWWE || 
                           searchQuery.toLowerCase().includes('wwe') || 
                           searchQuery.toLowerCase().includes('wrestlemania') ||
                           searchQuery.toLowerCase().includes('royal rumble') ||
                           searchQuery.toLowerCase().includes('clash') ||
                           searchQuery.toLowerCase().includes('raw') ||
                           searchQuery.toLowerCase().includes('smackdown');
        
        const isTVContent = isTV || type === 'series';
        
        if (isWWEContent) {
            console.log('WWE content detected, trying multiple search variations...');
            
            // Use predefined variations from WWE series parsing, or create new ones
            let variations = searchVariations || [
                searchQuery, // Original query
                searchQuery.replace(/\b(2024|2025)\b/g, '').trim(), // Without year
                searchQuery.replace(/\bWWE\s*/i, '').trim(), // Without WWE prefix
            ];
            
            // For WrestleMania, try with both "XL" and "40"
            if (searchQuery.toLowerCase().includes('wrestlemania')) {
                if (searchQuery.includes('XL')) {
                    variations.push(searchQuery.replace(/XL/g, '40'));
                }
                if (searchQuery.includes('40')) {
                    variations.push(searchQuery.replace(/40/g, 'XL'));
                }
                // Also try just "WrestleMania 40" or "WrestleMania XL"
                variations.push('WrestleMania 40');
                variations.push('WrestleMania XL');
            }
            
            // For Clash events, try simpler terms
            if (searchQuery.toLowerCase().includes('clash')) {
                variations.push('WWE Clash');
                if (searchQuery.includes('Paris')) {
                    variations.push('Clash in Paris');
                }
            }
            
            // Remove duplicates and try each variation
            const uniqueVariations = [...new Set(variations)];
            console.log('Trying search variations:', uniqueVariations);
            
            for (const variation of uniqueVariations) {
                if (variation.trim()) {
                    console.log(`Trying variation: "${variation}"`);
                    const variationTorrents = await scraper.searchAndGetComplete(
                        variation, 
                        type, 
                        year, 
                        season, 
                        episode
                    );
                    
                    if (variationTorrents.length > 0) {
                        console.log(`Found ${variationTorrents.length} torrents with variation: "${variation}"`);
                        torrents = variationTorrents;
                        break; // Use first successful variation
                    }
                }
            }
        } else if (isTVContent && searchVariations) {
            console.log('TV series detected, trying multiple search variations...');
            
            // Use predefined TV variations
            const uniqueVariations = [...new Set(searchVariations)];
            console.log('Trying TV search variations:', uniqueVariations);
            
            for (const variation of uniqueVariations) {
                if (variation.trim()) {
                    console.log(`Trying TV variation: "${variation}"`);
                    const variationTorrents = await scraper.searchAndGetComplete(
                        variation, 
                        type, 
                        year, 
                        season, 
                        episode
                    );
                    
                    if (variationTorrents.length > 0) {
                        console.log(`Found ${variationTorrents.length} torrents with TV variation: "${variation}"`);
                        torrents = variationTorrents;
                        break; // Use first successful variation
                    }
                }
            }
        } else {
            // Regular search for non-WWE/non-enhanced content
            torrents = await scraper.searchAndGetComplete(
                searchQuery, 
                type, 
                year, 
                season, 
                episode
            );
        }

        if (torrents.length === 0) {
            console.log('No torrents found');
            return { streams: [] };
        }

        console.log(`Found ${torrents.length} torrents`);

        // Sort torrents by quality (resolution), then seeders, then size
        const sortedTorrents = torrents.sort((a, b) => {
            // 1. Sort by resolution (4K > 2160p > 1440p > 1080p > 720p > 480p > others)
            const resolutionOrder = {
                '4K': 6, '2160p': 6,
                '1440p': 5, '1440': 5,
                '1080p': 4, '1080': 4, 'FHD': 4,
                '720p': 3, '720': 3, 'HD': 3,
                '480p': 2, '480': 2,
                'SD': 1
            };

            const getResolutionScore = (torrent) => {
                const title = torrent.title.toLowerCase();
                const quality = torrent.quality.toLowerCase();
                
                // Check for 4K indicators
                if (title.includes('4k') || title.includes('2160p') || quality.includes('2160p')) return 6;
                if (title.includes('1440p') || quality.includes('1440p')) return 5;
                if (title.includes('1080p') || quality.includes('1080p') || quality.includes('fhd')) return 4;
                if (title.includes('720p') || quality.includes('720p') || quality.includes('hd')) return 3;
                if (title.includes('480p') || quality.includes('480p')) return 2;
                return 1; // Default for SD or unknown
            };

            const aResolution = getResolutionScore(a);
            const bResolution = getResolutionScore(b);

            if (aResolution !== bResolution) {
                return bResolution - aResolution; // Higher resolution first
            }

            // 2. Sort by seeders (more seeders = better)
            if (a.seeders !== b.seeders) {
                return b.seeders - a.seeders;
            }

            // 3. Sort by file size (larger files usually better quality)
            const parseSize = (sizeStr) => {
                if (!sizeStr) return 0;
                const size = parseFloat(sizeStr);
                if (sizeStr.toLowerCase().includes('gb')) return size * 1024;
                if (sizeStr.toLowerCase().includes('mb')) return size;
                return size;
            };

            const aSize = parseSize(a.size);
            const bSize = parseSize(b.size);

            return bSize - aSize; // Larger size first
        });

        console.log(`Sorted ${sortedTorrents.length} torrents by resolution, seeders, and size`);

        // Balance streams across resolutions (max 3 per resolution)
        const balancedTorrents = balanceStreamsByResolution(sortedTorrents, 3);
        
        console.log(`Balanced to ${balancedTorrents.length} torrents across all resolutions`);

        // Convert torrents to Stremio streams
        const streams = await Promise.all(
            balancedTorrents.map(torrent => createStreamFromTorrent(torrent))
        );

        const validStreams = streams.filter(stream => stream !== null);
        
        // Cache results
        cache.set(cacheKey, {
            data: { streams: validStreams },
            timestamp: Date.now()
        });

        console.log(`Returning ${validStreams.length} streams`);
        return { streams: validStreams };

    } catch (error) {
        console.error('Stream handler error:', error);
        return { streams: [] };
    }
});

// Large database of IMDB ID to title mappings
function getImdbTitleMapping() {
    return {
        // John Wick Series
        'tt6146586': 'John Wick Chapter 3 Parabellum 2019',
        'tt2911666': 'John Wick 2014',
        'tt4425200': 'John Wick Chapter 2 2017', 
        'tt10366206': 'John Wick Chapter 4 2023',
        
        // Popular Action Movies
        'tt0468569': 'The Dark Knight 2008',
        'tt1375666': 'Inception 2010',
        'tt0137523': 'Fight Club 1999',
        'tt0109830': 'Forrest Gump 1994',
        'tt0111161': 'The Shawshank Redemption 1994',
        'tt0816692': 'Interstellar 2014',
        'tt1853728': 'Django Unchained 2012',
        'tt0103064': 'Terminator 2 Judgment Day 1991',
        'tt0133093': 'The Matrix 1999',
        'tt0120586': 'American History X 1998',
        
        // Marvel Movies
        'tt4154756': 'Avengers Endgame 2019',
        'tt4154664': 'Avengers Infinity War 2018',
        'tt1228705': 'Iron Man 2 2010',
        'tt0371746': 'Iron Man 2008',
        'tt0800080': 'The Incredible Hulk 2008',
        'tt0458339': 'Captain America The First Avenger 2011',
        'tt1843866': 'Captain America The Winter Soldier 2014',
        'tt3498820': 'Captain America Civil War 2016',
        'tt0800369': 'Thor 2011',
        'tt1981115': 'Thor The Dark World 2013',
        'tt3501632': 'Thor Ragnarok 2017',
        'tt10648342': 'Thor Love and Thunder 2022',
        'tt0848228': 'The Avengers 2012',
        'tt2395427': 'Avengers Age of Ultron 2015',
        
        // DC Movies
        'tt0372784': 'Batman Begins 2005',
        'tt1345836': 'The Dark Knight Rises 2012',
        'tt0451279': 'Wonder Woman 2017',
        'tt0974015': 'Justice League 2017',
        'tt12361974': 'Zack Snyder Justice League 2021',
        'tt0770828': 'Man of Steel 2013',
        'tt2975590': 'Batman v Superman Dawn of Justice 2016',
        'tt7126948': 'Wonder Woman 1984 2020',
        'tt1386697': 'Suicide Squad 2016',
        'tt6334354': 'The Suicide Squad 2021',
        
        // Fast & Furious
        'tt0232500': 'The Fast and the Furious 2001',
        'tt0322259': '2 Fast 2 Furious 2003',
        'tt0463985': 'The Fast and the Furious Tokyo Drift 2006',
        'tt1013752': 'Fast and Furious 2009',
        'tt1596343': 'Fast Five 2011',
        'tt1905041': 'Fast and Furious 6 2013',
        'tt2820852': 'Furious 7 2015',
        'tt4630562': 'The Fate of the Furious 2017',
        'tt6806448': 'Fast and Furious Presents Hobbs and Shaw 2019',
        'tt5433140': 'F9 The Fast Saga 2021',
        
        // Horror Movies
        'tt1396484': 'It 2017',
        'tt7349950': 'It Chapter Two 2019',
        'tt0816711': 'World War Z 2013',
        'tt1431045': 'Deadpool 2016',
        'tt5463162': 'Deadpool 2 2018',
        'tt6263850': 'Deadpool and Wolverine 2024',
        'tt0448115': 'Shutter Island 2010',
        'tt0758758': 'Into the Wild 2007',
        'tt1205489': 'Gran Torino 2008',
        
        // Sci-Fi
        'tt0481499': 'Blade Runner 2049 2017',
        'tt0083658': 'Blade Runner 1982',
        'tt0076759': 'Star Wars A New Hope 1977',
        'tt0080684': 'Star Wars The Empire Strikes Back 1980',
        'tt0086190': 'Star Wars Return of the Jedi 1983',
        'tt2488496': 'Star Wars The Force Awakens 2015',
        'tt2527336': 'Star Wars The Last Jedi 2017',
        'tt2527338': 'Star Wars The Rise of Skywalker 2019',
        'tt3748528': 'Rogue One A Star Wars Story 2016',
        
        // Recent Popular Movies
        'tt1745960': 'Top Gun Maverick 2022',
        'tt6751668': 'Parasite 2019',
        'tt7286456': 'Joker 2019',
        'tt9376612': 'Shang Chi and the Legend of the Ten Rings 2021',
        'tt9114286': 'Black Widow 2021',
        'tt9032400': 'Eternals 2021',
        'tt10872600': 'Spider Man No Way Home 2021',
        'tt9419884': 'Doctor Strange in the Multiverse of Madness 2022',
        
        // Classic Movies
        'tt0110912': 'Pulp Fiction 1994',
        'tt0108052': 'Schindlers List 1993',
        'tt0167260': 'The Lord of the Rings The Return of the King 2003',
        'tt0120737': 'The Lord of the Rings The Fellowship of the Ring 2001',
        'tt0167261': 'The Lord of the Rings The Two Towers 2002',
        'tt0068646': 'The Godfather 1972',
        'tt0071562': 'The Godfather Part II 1974',
        'tt0099685': 'Goodfellas 1990',
        'tt0114369': 'Se7en 1995',
        'tt0102926': 'The Silence of the Lambs 1991',
        
        // Comedy Movies
        'tt0110413': 'Léon The Professional 1994',
        'tt0120815': 'Saving Private Ryan 1998',
        'tt0993846': 'The Wolf of Wall Street 2013',
        'tt1049413': 'Up 2009',
        'tt0317248': 'City of God 2002',
        'tt0118799': 'Life Is Beautiful 1997',
        'tt0245429': 'Spirited Away 2001',
        
        // Mission Impossible Series  
        'tt0117060': 'Mission Impossible 1996',
        'tt0120755': 'Mission Impossible II 2000',
        'tt0317919': 'Mission Impossible III 2006',
        'tt1229238': 'Mission Impossible Ghost Protocol 2011',
        'tt2381249': 'Mission Impossible Rogue Nation 2015',
        'tt4912910': 'Mission Impossible Fallout 2018',
        'tt9603212': 'Mission Impossible Dead Reckoning Part One 2023',
        
        // James Bond
        'tt2379713': 'Skyfall 2012',
        'tt1074638': 'Spectre 2015',
        'tt2382320': 'No Time to Die 2021',
        'tt0381061': 'Casino Royale 2006',
        'tt0830515': 'Quantum of Solace 2008',
        
        // Popular TV Series
        'tt0944947': 'Game of Thrones',
        'tt0903747': 'Breaking Bad',
        'tt2356777': 'True Detective',
        'tt1475582': 'Sherlock',
        'tt2861424': 'Rick and Morty',
        'tt0436992': 'Doctor Who 2005',
        'tt1844624': 'American Horror Story',
        'tt2085059': 'Black Mirror',
        'tt5753856': 'Dark',
        'tt4574334': 'Stranger Things',
        'tt1190634': 'The Boys',
        'tt6468322': 'Money Heist',
        'tt5420376': 'Squid Game',
        'tt1439629': 'Community',
        'tt0898266': 'The Big Bang Theory',
        'tt0386676': 'The Office',
        'tt0108778': 'Friends',
        'tt7366338': 'Chernobyl',
        'tt1596343': 'Suits',
        'tt4052886': 'Lucifer',
        'tt1632701': 'Suits',
        'tt1442437': 'Modern Family',
        'tt1845307': 'Nashville',
        'tt6741278': 'Anne with an E',
        'tt1442437': 'Modern Family',
        
        // More Recent Popular Movies
        'tt6264654': 'Free Guy 2021',
        'tt1877830': 'X-Men Days of Future Past 2014',
        'tt0371746': 'Iron Man 2008',
        'tt0800080': 'The Incredible Hulk 2008',
        'tt3896198': 'Guardians of the Galaxy Vol 2 2017',
        'tt2015381': 'Guardians of the Galaxy 2014',
        'tt0478970': 'Ant-Man 2015',
        'tt5095030': 'Ant-Man and the Wasp 2018',
        'tt6320628': 'Spider-Man Far From Home 2019',
        'tt2250912': 'Spider-Man Homecoming 2017',
        'tt3480822': 'Black Panther 2018',
        'tt4154664': 'Captain Marvel 2019',
        
        // Add more as needed...
    };
}

// Balance torrents across resolutions to provide variety
function balanceStreamsByResolution(torrents, maxPerResolution = 3) {
    const resolutionGroups = {};
    const result = [];

    // Group torrents by resolution
    torrents.forEach(torrent => {
        const resolutionScore = getResolutionScore(torrent);
        const resolutionKey = getResolutionLabel(torrent);
        
        if (!resolutionGroups[resolutionKey]) {
            resolutionGroups[resolutionKey] = [];
        }
        resolutionGroups[resolutionKey].push(torrent);
    });

    // Get resolution keys sorted by priority (4K first, then 1080p, etc.)
    const sortedResolutionKeys = Object.keys(resolutionGroups).sort((a, b) => {
        const aScore = getResolutionScoreFromLabel(a);
        const bScore = getResolutionScoreFromLabel(b);
        return bScore - aScore;
    });

    // Take up to maxPerResolution from each resolution category
    sortedResolutionKeys.forEach(resolutionKey => {
        const torrentsInResolution = resolutionGroups[resolutionKey];
        const selectedTorrents = torrentsInResolution.slice(0, maxPerResolution);
        result.push(...selectedTorrents);
    });

    return result;
}

// Helper function to get resolution score
function getResolutionScore(torrent) {
    const title = torrent.title.toLowerCase();
    const quality = torrent.quality.toLowerCase();
    
    if (title.includes('4k') || title.includes('2160p') || quality.includes('2160p')) return 6;
    if (title.includes('1440p') || quality.includes('1440p')) return 5;
    if (title.includes('1080p') || quality.includes('1080p') || quality.includes('fhd')) return 4;
    if (title.includes('720p') || quality.includes('720p') || quality.includes('hd')) return 3;
    if (title.includes('480p') || quality.includes('480p')) return 2;
    return 1;
}

// Helper function to get resolution label
function getResolutionLabel(torrent) {
    const title = torrent.title.toLowerCase();
    const quality = torrent.quality.toLowerCase();
    
    if (title.includes('4k') || title.includes('2160p') || quality.includes('2160p')) return '4K/2160p';
    if (title.includes('1440p') || quality.includes('1440p')) return '1440p';
    if (title.includes('1080p') || quality.includes('1080p') || quality.includes('fhd')) return '1080p';
    if (title.includes('720p') || quality.includes('720p') || quality.includes('hd')) return '720p';
    if (title.includes('480p') || quality.includes('480p')) return '480p';
    return 'SD/Other';
}

// Helper function to get resolution score from label
function getResolutionScoreFromLabel(label) {
    if (label === '4K/2160p') return 6;
    if (label === '1440p') return 5;
    if (label === '1080p') return 4;
    if (label === '720p') return 3;
    if (label === '480p') return 2;
    return 1;
}

// Parse WWE and Sports Entertainment content
function parseWWEContent(input) {
    const inputLower = input.toLowerCase();
    
    // WWE Event patterns
    const wwePatterns = [
        // Current PLEs (Premium Live Events)
        { pattern: /wwe.*clash.*castle/i, name: 'WWE Clash at the Castle' },
        { pattern: /wwe.*clash.*paris/i, name: 'WWE Clash in Paris' },
        { pattern: /wwe.*wrestlemania/i, name: 'WWE WrestleMania' },
        { pattern: /wwe.*royal.*rumble/i, name: 'WWE Royal Rumble' },
        { pattern: /wwe.*summerslam/i, name: 'WWE SummerSlam' },
        { pattern: /wwe.*survivor.*series/i, name: 'WWE Survivor Series' },
        { pattern: /wwe.*money.*bank/i, name: 'WWE Money in the Bank' },
        { pattern: /wwe.*elimination.*chamber/i, name: 'WWE Elimination Chamber' },
        { pattern: /wwe.*night.*champions/i, name: 'WWE Night of Champions' },
        { pattern: /wwe.*battleground/i, name: 'WWE Battleground' },
        { pattern: /wwe.*backlash/i, name: 'WWE Backlash' },
        { pattern: /wwe.*fastlane/i, name: 'WWE Fastlane' },
        { pattern: /wwe.*crown.*jewel/i, name: 'WWE Crown Jewel' },
        { pattern: /wwe.*extreme.*rules/i, name: 'WWE Extreme Rules' },
        { pattern: /wwe.*hell.*cell/i, name: 'WWE Hell in a Cell' },
        { pattern: /wwe.*judgement.*day/i, name: 'WWE Judgment Day' },
        { pattern: /wwe.*king.*ring/i, name: 'WWE King of the Ring' },
        { pattern: /wwe.*bad.*blood/i, name: 'WWE Bad Blood' },
        
        // Weekly Shows
        { pattern: /wwe.*raw/i, name: 'WWE Monday Night Raw' },
        { pattern: /wwe.*smackdown/i, name: 'WWE SmackDown' },
        { pattern: /wwe.*nxt/i, name: 'WWE NXT' },
        
        // Legacy PPVs
        { pattern: /wwe.*unforgiven/i, name: 'WWE Unforgiven' },
        { pattern: /wwe.*vengeance/i, name: 'WWE Vengeance' },
        { pattern: /wwe.*armageddon/i, name: 'WWE Armageddon' },
        { pattern: /wwe.*no.*mercy/i, name: 'WWE No Mercy' },
        { pattern: /wwe.*insurrextion/i, name: 'WWE Insurrextion' },
        
        // Other Wrestling Promotions
        { pattern: /aew.*revolution/i, name: 'AEW Revolution' },
        { pattern: /aew.*double.*nothing/i, name: 'AEW Double or Nothing' },
        { pattern: /aew.*all.*out/i, name: 'AEW All Out' },
        { pattern: /aew.*full.*gear/i, name: 'AEW Full Gear' },
        { pattern: /aew.*dynamite/i, name: 'AEW Dynamite' },
        { pattern: /aew.*rampage/i, name: 'AEW Rampage' },
        
        // UFC Events
        { pattern: /ufc.*\d+/i, name: 'UFC' },
        { pattern: /ufc.*fight.*night/i, name: 'UFC Fight Night' },
        
        // Boxing
        { pattern: /boxing/i, name: 'Boxing' },
        { pattern: /heavyweight.*championship/i, name: 'Heavyweight Championship' }
    ];
    
    // Check for WWE/Sports patterns
    for (const pattern of wwePatterns) {
        if (pattern.pattern.test(input)) {
            // Try to extract year from input
            const yearMatch = input.match(/20\d{2}/);
            const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
            
            // Create search query
            let searchQuery = pattern.name;
            if (year) {
                searchQuery += ` ${year}`;
            }
            
            return {
                searchQuery: searchQuery,
                title: pattern.name,
                year: year ? parseInt(year) : null,
                type: 'sports',
                isWWE: true
            };
        }
    }
    
    // General WWE/Sports detection
    if (inputLower.includes('wwe') || inputLower.includes('aew') || inputLower.includes('ufc') || 
        inputLower.includes('boxing') || inputLower.includes('wrestling')) {
        
        // Extract year
        const yearMatch = input.match(/20\d{2}/);
        const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
        
        // Clean up the title
        let cleanTitle = input
            .replace(/[._-]/g, ' ')
            .replace(/\b(tt\d+)\b/g, '') // Remove IMDB IDs
            .trim();
        
        if (year) {
            cleanTitle = cleanTitle.replace(year, '').trim() + ` ${year}`;
        }
        
        return {
            searchQuery: cleanTitle,
            title: cleanTitle.replace(year, '').trim(),
            year: year ? parseInt(year) : null,
            type: 'sports',
            isWWE: true
        };
    }
    
    return null;
}

// Parse stream ID to extract search information
async function parseStreamId(id) {
    try {
        console.log(`Parsing stream ID: ${id}`);
        
        // Handle different ID formats
        if (id.startsWith('tt') && !id.includes(':')) {
            // This is a simple IMDB ID (no series/episode info)
            // Handle regular IMDB ID format - use OMDB to get title
            console.log(`Looking up IMDB ID ${id} in OMDB...`);
            
            try {
                const omdbData = await omdbClient.getByImdbId(id);
                
                if (omdbData) {
                    const searchInfo = omdbClient.formatForSearch(omdbData);
                    console.log(`OMDB lookup successful: ${searchInfo.title} (${searchInfo.year})`);
                    
                    // Check if this is WWE content and simplify search query
                    if (searchInfo.title && (
                        searchInfo.title.toLowerCase().includes('wwe') ||
                        searchInfo.title.toLowerCase().includes('wrestlemania') ||
                        searchInfo.title.toLowerCase().includes('royal rumble') ||
                        searchInfo.title.toLowerCase().includes('summerslam') ||
                        searchInfo.title.toLowerCase().includes('clash')
                    )) {
                        // Simplify WWE search query - remove extra words that might not be in torrent names
                        let simpleQuery = searchInfo.title
                            .replace(/\b(kickoff|press|event)\b/gi, '') // Remove common extra words
                            .replace(/\bXL\b/g, '40') // Convert XL to 40 for WrestleMania
                            .replace(/\s+/g, ' ') // Clean up multiple spaces
                            .trim();
                        
                        if (searchInfo.year) {
                            simpleQuery += ` ${searchInfo.year}`;
                        }
                        
                        console.log(`WWE content detected, using simplified query: ${simpleQuery}`);
                        return {
                            searchQuery: simpleQuery,
                            title: searchInfo.title,
                            year: searchInfo.year,
                            type: searchInfo.type,
                            isWWE: true
                        };
                    }
                    
                    return {
                        searchQuery: searchInfo.searchQuery,
                        title: searchInfo.title,
                        year: searchInfo.year,
                        type: searchInfo.type
                    };
                } else {
                    console.log(`OMDB lookup failed for ${id}, trying fallback...`);
                    // Fallback to hardcoded database for popular titles
                    return await parseImdbIdFallback(id);
                }
            } catch (error) {
                console.error(`OMDB error for ${id}:`, error.message);
                // Fallback to hardcoded database
                return await parseImdbIdFallback(id);
            }
        }
        
        // Handle other formats (direct title searches and series)
        const parts = id.split(':');
        if (parts.length >= 2) {
            // Check if first part is an IMDB ID with series/episode info
            if (parts[0].startsWith('tt') && parts.length >= 3) {
                // This is a series format like tt0185103:33:33 (imdb:season:episode)
                const imdbId = parts[0];
                const season = parseInt(parts[1]);
                const episode = parseInt(parts[2]);
                
                console.log(`Series format detected: ${imdbId} S${season}E${episode}`);
                
                try {
                    const omdbData = await omdbClient.getByImdbId(imdbId);
                    if (omdbData) {
                        const searchInfo = omdbClient.formatForSearch(omdbData);
                        console.log(`OMDB lookup successful for series: ${searchInfo.title} (${searchInfo.year})`);
                        
                        // Check if this is WWE content and create episode-specific searches
                        console.log(`Checking if WWE content: ${searchInfo.title}`);
                        if (searchInfo.title && (
                            searchInfo.title.toLowerCase().includes('wwe') ||
                            searchInfo.title.toLowerCase().includes('raw') ||
                            searchInfo.title.toLowerCase().includes('smackdown') ||
                            searchInfo.title.toLowerCase().includes('wrestle')
                        )) {
                            console.log(`WWE series detected: ${searchInfo.title} S${season}E${episode}`);
                            
                            // For WWE series, we need to search for specific episodes or date ranges
                            // Convert season/episode to approximate year/month for WWE shows
                            const baseYear = searchInfo.year ? parseInt(searchInfo.year) : 1993;
                            const episodeYear = baseYear + Math.floor(season / 12); // Approximate year based on season
                            const episodeMonth = (season % 12) + 1; // Convert to month
                            
                            console.log(`Calculated episode timing: Year ${episodeYear}, Month ${episodeMonth}`);
                            
                            // Create multiple search variations for WWE episodes
                            const showName = searchInfo.title.replace(/^WWE\s*/i, '');
                            const searchVariations = [
                                `${searchInfo.title} ${episodeYear}`, // WWE Raw 2024
                                `${showName} ${episodeYear}`, // Raw 2024
                                `WWE ${showName} ${episodeYear} ${episodeMonth.toString().padStart(2, '0')}`, // WWE Raw 2024 03
                                `${searchInfo.title} S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`, // WWE Raw S33E15
                                `${showName} S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`, // Raw S33E15
                            ];
                            
                            console.log(`Generated WWE search variations:`, searchVariations);
                            
                            return {
                                searchQuery: searchVariations[0], // Primary search
                                searchVariations: searchVariations, // All variations to try
                                title: searchInfo.title,
                                year: searchInfo.year,
                                season: season,
                                episode: episode,
                                type: 'series',
                                isWWE: true
                            };
                        }
                        
                        console.log(`Regular series (non-WWE): ${searchInfo.title}`);
                        
                        // For regular TV series, create multiple search variations
                        const baseTitle = searchInfo.title;
                        const seasonEpisode = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
                        
                        // Check if this might be anime (common indicators)
                        const isLikelyAnime = searchInfo.title && (
                            searchInfo.title.includes('Naruto') ||
                            searchInfo.title.includes('One Piece') ||
                            searchInfo.title.includes('Attack on Titan') ||
                            searchInfo.title.includes('Dragon Ball') ||
                            searchInfo.title.includes('Death Note') ||
                            searchInfo.title.includes('Bleach') ||
                            searchInfo.title.includes('Hunter') ||
                            (searchInfo.year && parseInt(searchInfo.year) >= 1990 && 
                             /[^\x00-\x7F]/.test(searchInfo.title)) // Non-ASCII characters
                        );
                        
                        let tvSearchVariations;
                        
                        if (isLikelyAnime) {
                            console.log(`Anime series detected: ${baseTitle}`);
                            // Anime-specific search patterns
                            tvSearchVariations = [
                                `${baseTitle} ${seasonEpisode}`, // Attack on Titan S01E01
                                `${baseTitle} Episode ${episode}`, // Attack on Titan Episode 1
                                `${baseTitle} ${episode.toString().padStart(2, '0')}`, // Attack on Titan 01
                                `${baseTitle} ${season > 1 ? `Season ${season} ` : ''}Episode ${episode}`, // Attack on Titan Season 2 Episode 1
                                baseTitle, // Attack on Titan (for batch downloads)
                            ];
                        } else {
                            console.log(`Regular TV series detected: ${baseTitle}`);
                            // Regular TV series search patterns
                            tvSearchVariations = [
                                `${baseTitle} ${seasonEpisode}`, // Game of Thrones S01E01
                                `${baseTitle} ${searchInfo.year} ${seasonEpisode}`, // Game of Thrones 2011 S01E01  
                                `${baseTitle.replace(/\s+/g, '.')} ${seasonEpisode}`, // Game.of.Thrones S01E01
                                baseTitle, // Game of Thrones (for season packs)
                            ];
                            
                            // Add common quality variations for popular series
                            if (searchInfo.year && parseInt(searchInfo.year) >= 2010) {
                                tvSearchVariations.push(`${baseTitle} ${seasonEpisode} 1080p`);
                                tvSearchVariations.push(`${baseTitle} ${seasonEpisode} 720p`);
                            }
                        }
                        
                        console.log(`Generated TV search variations:`, tvSearchVariations);
                        
                        return {
                            searchQuery: tvSearchVariations[0], // Primary search
                            searchVariations: tvSearchVariations, // All variations to try
                            title: searchInfo.title,
                            year: searchInfo.year,
                            season: season,
                            episode: episode,
                            type: 'series',
                            isTV: true,
                            isAnime: isLikelyAnime
                        };
                    }
                } catch (error) {
                    console.error(`OMDB error for series ${imdbId}:`, error.message);
                }
                
                // Fallback for series without OMDB data
                return {
                    searchQuery: `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`,
                    season: season,
                    episode: episode,
                    type: 'series'
                };
            }
            
            // Handle other title-based formats
            const searchQuery = parts[1].replace(/[._-]/g, ' ');
            
            // Check if this looks like WWE content
            const wweCheck = parseWWEContent(searchQuery);
            if (wweCheck) {
                console.log(`Detected WWE/Sports content from title: ${wweCheck.searchQuery}`);
                return wweCheck;
            }
            
            // Try to extract year, season, episode from additional parts
            let year = null;
            let season = null;
            let episode = null;
            
            for (let i = 2; i < parts.length; i++) {
                const part = parts[i];
                if (part.match(/^\d{4}$/)) {
                    year = parseInt(part);
                } else if (part.startsWith('s') || part.startsWith('S')) {
                    season = parseInt(part.substring(1));
                } else if (part.startsWith('e') || part.startsWith('E')) {
                    episode = parseInt(part.substring(1));
                }
            }
            
            return { searchQuery, year, season, episode };
        }
        
        // Check if direct ID looks like WWE content
        const wweCheck = parseWWEContent(id);
        if (wweCheck) {
            console.log(`Detected WWE/Sports content from direct ID: ${wweCheck.searchQuery}`);
            return wweCheck;
        }
        
        return { searchQuery: id.replace(/[._-]/g, ' ') };
    } catch (error) {
        console.error('Error parsing stream ID:', error);
        return { searchQuery: null };
    }
}

// Fallback function for popular titles when OMDB fails
async function parseImdbIdFallback(id) {
    const imdbToTitle = getImdbTitleMapping();
    
    const title = imdbToTitle[id];
    if (title) {
        console.log(`Found fallback title for IMDB ID ${id}: ${title}`);
        // Extract year from title if present
        const yearMatch = title.match(/(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1]) : null;
        const searchQuery = title.replace(/\d{4}/, '').trim();
        
        return { searchQuery, year };
    } else {
        console.log(`No fallback mapping found for IMDB ID: ${id}`);
        return { searchQuery: null };
    }
}

// Create Stremio stream object from torrent
async function createStreamFromTorrent(torrent) {
    try {
        if (!torrent.magnet) {
            return null;
        }

        // Clean up torrent title for display (similar to Torrentio)
        let cleanTitle = torrent.title
            .replace(/\[.*?\]/g, '') // Remove brackets like [YTS], [RARBG]
            .replace(/\(.*?\)/g, '') // Remove parentheses with years if duplicated
            .replace(/\s+/g, ' ')    // Clean up multiple spaces
            .trim();

        // Extract quality indicators like Torrentio
        const qualityIndicators = [];
        
        // Check for 4K/2160p
        if (torrent.quality.includes('2160p') || torrent.title.toLowerCase().includes('4k')) {
            qualityIndicators.push('4K');
        }
        
        // Check for HDR
        if (torrent.title.toLowerCase().includes('hdr') || torrent.title.toLowerCase().includes('dolby vision') || torrent.title.toLowerCase().includes('dv')) {
            qualityIndicators.push('HDR');
        }
        
        // Check for Dolby Atmos
        if (torrent.title.toLowerCase().includes('atmos')) {
            qualityIndicators.push('ATMOS');
        }
        
        // Check for REMUX
        if (torrent.title.toLowerCase().includes('remux')) {
            qualityIndicators.push('REMUX');
        }

        // Two-column format: Left: "1337x Quality", Right: "Title ; size ; seeders"
        const qualityBadge = qualityIndicators.length > 0 ? qualityIndicators.join(' ') : torrent.quality;
        
        // Left column (source name): "1337x" on line 1, quality on line 2
        const sourceName = `1337x
${qualityBadge}`;
        
        // Clean size field (remove any trailing numbers that got mixed in)
        const cleanSize = torrent.size.replace(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|TB))\d+$/, '$1').trim();
        
        // Right column (title): "Movie Title\n💾 size 🌱 seeders"
        const streamTitle = `${cleanTitle}
💾 ${cleanSize} 🌱 ${torrent.seeders}`;

        // Return magnet link directly
        return {
            name: sourceName,
            title: streamTitle,
            url: torrent.magnet,
            behaviorHints: {
                bingeGroup: '1337x-magnet-addon'
            }
        };
    } catch (error) {
        console.error('Error creating stream from torrent:', error);
        // Even if there's an error, try to return the magnet link
        if (torrent.magnet) {
            const cleanTitle = torrent.title.replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
            const cleanSize = torrent.size.replace(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|TB))\d+$/, '$1').trim();
            const sourceName = `1337x
${torrent.quality}`;
            const streamTitle = `${cleanTitle}
💾 ${cleanSize} 🌱 ${torrent.seeders}`;
            return {
                name: sourceName,
                title: streamTitle,
                url: torrent.magnet,
                behaviorHints: {
                    bingeGroup: '1337x-magnet-addon'
                }
            };
        }
        return null;
    }
}

// Vercel serverless export
const handler = builder.getInterface();
module.exports = handler;
exports.default = handler;
