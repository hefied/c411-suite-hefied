// ==UserScript==
// @name         C411.org — Suite Ultra Pro ✦ TMDB + Filtres v5.4
// @namespace    https://github.com/hefied/
// @version      5.4.0
// @description  Popup TMDB + Filtres séries + Boutons inline + Badge PLUS (smart positioning)
// @author       Hefied
// @match        *://c411.org/*
// @match        *://www.c411.org/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @connect      api.themoviedb.org
// @connect      image.tmdb.org
// @connect      api.alldebrid.com
// @connect      c411.org
// @connect      www.c411.org
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    //  ① CONFIGURATION — modifier ici vos clés API
    // ═══════════════════════════════════════════════════════════════════════════
    const CFG = {
        // ── TMDB ──────────────────────────────────────────────────────────────
        TMDB_API_KEY   : 'VOTRE_CLE_TMDB_ICI',
        TMDB_BASE      : 'https://api.themoviedb.org/3',
        IMG_BASE       : 'https://image.tmdb.org/t/p/',
        LANGUAGE       : 'fr-FR',
        FALLBACK_LANG  : 'en-US',
        CACHE_TTL_MS   : 7 * 24 * 60 * 60 * 1000,
        HOVER_DELAY_MS : 380,
        HIDE_DELAY_MS  : 200,
        POPUP_W        : 740,
        POPUP_H        : 360,
        MOUSE_OFFSET_X : 24,
        MOUSE_OFFSET_Y : -50,
        MAX_SYNOPSIS   : 200,
        PRELOAD_RADIUS : 2,

        // ── AllDebrid ─────────────────────────────────────────────────────────
        // → Récupérer sur https://alldebrid.com/apikeys/
        ALLDEBRID_KEY  : 'VOTRE_CLE_ALLDEBRID_ICI',
        ALLDEBRID_BASE : 'https://api.alldebrid.com/v4',
        ALLDEBRID_AGENT: 'C411Suite_Hefied',

        // ── Filtres ────────────────────────────────────────────────────────────
        DEBOUNCE_MS    : 180,
        MAX_SIZE_GB    : 120,
        NEW_HOURS      : 48,
        STORAGE_KEY    : 'c411_filters_v5',
        PRESET_KEY     : 'c411_presets_v5',

        // ── Init ───────────────────────────────────────────────────────────────
        INIT_DELAY_MS  : 1200,
        RETRY_MAX      : 12,
        RETRY_DELAY    : 800,
        DEBUG          : false,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ② LOGGER
    // ═══════════════════════════════════════════════════════════════════════════
    const log = {
        i : (...a) => CFG.DEBUG && console.log('%c[C411]', 'color:#34d399;font-weight:bold', ...a),
        w : (...a) => console.warn('[C411]', ...a),
        e : (...a) => console.error('[C411]', ...a),
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ③ UTILS
    // ═══════════════════════════════════════════════════════════════════════════
    const Utils = {
        debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },

        parseSizeGB(str) {
            if (!str) return 0;
            const m = str.trim().match(/([\d.,]+)\s*(go|gb|gio|gib|mo|mb|mio|mib|to|tb)/i);
            if (!m) return 0;
            const val = parseFloat(m[1].replace(',', '.'));
            const u   = m[2].toLowerCase();
            if (u.startsWith('t')) return val * 1024;
            if (u.startsWith('g')) return val;
            if (u.startsWith('m')) return val / 1024;
            return 0;
        },

        formatGB(gb) {
            if (gb >= 1) return gb.toFixed(1) + ' GB';
            if (gb > 0)  return (gb * 1024).toFixed(0) + ' MB';
            return '0';
        },

        // Extraire le hash C411 depuis une URL /torrents/HASH
        extractHash(href) {
            const m = href?.match(/\/torrents\/([a-f0-9]{20,})/i);
            return m ? m[1] : null;
        },

        // Construire un lien magnet depuis un hash
        buildMagnet(hash, title = '') {
            const dn = title ? '&dn=' + encodeURIComponent(title) : '';
            return `magnet:?xt=urn:btih:${hash}${dn}`;
        },

        // Copier dans le presse-papier
        copyToClipboard(text) {
            try {
                GM_setClipboard(text, 'text');
                return true;
            } catch {
                try { navigator.clipboard.writeText(text); return true; }
                catch { return false; }
            }
        },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ④ CACHE TMDB  (mémoire + GM_setValue persistant)
    // ═══════════════════════════════════════════════════════════════════════════
    const Cache = (() => {
        const mem = new Map();
        const k   = t => 'c411_tmdb5_' + btoa(encodeURIComponent(t)).replace(/=/g, '').slice(0, 80);

        function get(title) {
            if (mem.has(title)) return mem.get(title);
            try {
                const raw = GM_getValue(k(title));
                if (!raw) return null;
                const { ts, data } = JSON.parse(raw);
                if (Date.now() - ts > CFG.CACHE_TTL_MS) { GM_setValue(k(title), null); return null; }
                mem.set(title, data);
                return data;
            } catch { return null; }
        }

        function set(title, data) {
            mem.set(title, data);
            try { GM_setValue(k(title), JSON.stringify({ ts: Date.now(), data })); }
            catch (e) { log.w('Cache write failed', e); }
        }

        function has(title) { return get(title) !== null; }
        return { get, set, has };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑤ PARSER DE TITRES RELEASES
    // ═══════════════════════════════════════════════════════════════════════════
    const TitleParser = (() => {
        const STRIP = [
            /\b(4K|UHD|2160p?|1080[pi]?|720p?|576p?|480p?|360p?|SD|HD|FHD|QHD)\b/gi,
            /\b(BluRay|Blu-?Ray|BDRIP|BDR|BRRip|WEB[-.]?DL|WEB[-.]?RIP|WEBRIP|HDTV|DVDRIP|DVD|PDVD|R5|SCR|CAM|TS|HC|HDCAM|AMZN|DSNP|HMAX|NF|APPLE|ATVP|PCOK|STAN|HULU|HDLight|BDISO|ISO|PPVRIP)\b/gi,
            /\b(x264|x265|H\.?264|H\.?265|HEVC|AVC|XVID|DIVX|VP9|AV1|10bit|8bit)\b/gi,
            /\b(AAC|AC3|DTS[-.]?HD|DTS|TrueHD|ATMOS|DD5?\.?1|EAC3|FLAC|MP3|OPUS|DD[+]?|LPCM|2\.0|5\.1|7\.1)\b/gi,
            /\b(FRENCH|TRUEFRENCH|VOSTFR|VOST|VFF|VF|VFQ|VF2|MULTi|MULTI|DUAL|VO|VOF|SUBFRENCH|STV|VOFR|TRDF)\b/gi,
            /\b(PROPER|REPACK|REAL|READNFO|EXTENDED|THEATRICAL|UNRATED|DIRECTORS?\.?CUT|DC|IMAX|3D|REMUX|REMASTERED?|HYBRID|HDR10?|DOVI|DoVi|HLG|SDR|COMPLETE|PACK|SEASON|EPISODE|INTEGRALE|Integrale|SAISON)\b/gi,
            /\b\d+[\.,]?\d*\s?(GB|MB|GiB|MiB)\b/gi,
            /\[.*?\]/g,
            /-[A-Z0-9]{2,12}$/gi,
            /\b[0-9a-fA-F]{8,}\b/g,
            /[._]+/g,
            /\s{2,}/g,
        ];

        const SERIES_RE = /\b(S\d{1,2}E\d{1,2}|S\d{1,2}(?!\d)|Saison\s?\d+|Season\s?\d+|\d+x\d+)\b/i;
        const YEAR_RE   = /\b(19[0-9]{2}|20[0-2][0-9]|2030)\b/;
        const CUT_RE    = /\b(4K|UHD|2160|1080|720|BluRay|Bluray|BLURAY|WEB|HDTV|BDRIP|x264|x265|FRENCH|MULTI|HEVC|H264|H265|REMUX|HDR)\b/i;

        // Extraire le numéro de saison depuis le nom brut
        function extractSeason(raw) {
            const m = raw.match(/\bS(\d{1,2})(?:E\d{1,2})?\b/i) ||
                      raw.match(/\bSaison\s?(\d{1,2})\b/i) ||
                      raw.match(/\bSeason\s?(\d{1,2})\b/i);
            return m ? parseInt(m[1]) : null;
        }

        function parse(raw) {
            let title = raw.trim();
            const yearMatch = title.match(YEAR_RE);
            const year      = yearMatch ? parseInt(yearMatch[1]) : null;
            const isSeries  = SERIES_RE.test(title);
            const season    = extractSeason(title);

            for (const re of [YEAR_RE, SERIES_RE, CUT_RE]) {
                const m = title.match(re);
                if (m && m.index > 3) { title = title.slice(0, m.index); break; }
            }
            for (const pat of STRIP) title = title.replace(pat, ' ');
            title = title.replace(/\s+/g, ' ').trim().replace(/^[-\s]+|[-\s]+$/g, '');
            title = title.replace(/\b\w/g, c => c.toUpperCase());
            return { title, year, isSeries, season };
        }

        return { parse, extractSeason };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑥ PATTERNS DE DÉTECTION POUR LES FILTRES
    // ═══════════════════════════════════════════════════════════════════════════
    const P = {
        YEAR    : /\b(19[0-9]{2}|20[0-2][0-9]|2030)\b/,

        QUALITY : {
            '4K / UHD' : /\b(4K|UHD|2160p?)\b/i,
            '1080p'    : /\b1080[pi]?\b/i,
            '720p'     : /\b720p?\b/i,
            '480p'     : /\b480p?\b/i,
            'BluRay'   : /\b(BluRay|Blu-?Ray|BDRip|BLURAY)\b/i,
            'WEB-DL'   : /\b(WEB[-.]?DL|WEBDL|AMZN|NF|DSNP)\b/i,
            'WEBRip'   : /\b(WEB[-.]?RIP|WEBRIP)\b/i,
            'REMUX'    : /\bREMUX\b/i,
            'HDTV'     : /\bHDTV\b/i,
            'DVDRip'   : /\b(DVDRip|DVD)\b/i,
            'HDR'      : /\b(HDR10?|DV|DoVi|DOVI|HLG)\b/i,
        },

        LANGUAGE_BADGE : {
            'TrueFrench' : /TrueFrench|VFF/i,
            'VF'         : /Français.*inclus|^Français\b/i,
            'VOSTFR'     : /VOSTFR/i,
            'MULTI'      : /Multi|multi/i,
            'VO'         : /\bVO\b/i,
        },

        LANGUAGE_NAME : {
            'TrueFrench' : /\b(TRUEFRENCH|TRDF|VFF)\b/i,
            'VF'         : /\b(VF|VFF|VFQ|VF2|FRENCH)(?!E)\b/i,
            'VOSTFR'     : /\b(VOSTFR|VOFR)\b/i,
            'MULTI'      : /\bMULTi\b/i,
            'VO'         : /\bVO\b/i,
        },

        TYPE : {
            'Série'      : /\b(S\d{1,2}E\d{1,2}|S\d{1,2}(?!\d)|INTEGRALE|Integrale)\b/i,
            'Anime'      : /\bAnime\b/i,
        },

        SUBCAT_TYPE : {
            'Série TV'        : 'Série',
            'Animation Série' : 'Série',
            'Animation'       : 'Anime',
            'Documentaire'    : 'Documentaire',
            'Film'            : 'Film',
            'Spectacle'       : 'Spectacle',
            'Emission TV'     : 'Émission TV',
            'Concert'         : 'Concert',
        },

        // Extraire le numéro de saison
        SEASON_RE : /\bS(\d{1,2})(?:E\d{1,2})?\b/i,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑦ DOM HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    const DOM = {
        findResultsBlock() {
            for (const div of document.querySelectorAll('div[data-v-47f00934]')) {
                const span = div.querySelector(':scope > div > span');
                if (span?.textContent?.includes('Résultats de recherche')) return div;
            }
            for (const s of document.querySelectorAll('span')) {
                if (s.textContent.trim() === 'Résultats de recherche') {
                    const b = s.closest('[data-v-47f00934]');
                    if (b) return b;
                }
            }
            return null;
        },

        findRows(root = document) {
            const rows = new Set();
            root.querySelectorAll('posterhoverpopover').forEach(pp => {
                let el = pp.parentElement;
                while (el && el !== document.body) {
                    if (el.classList.contains('transition-colors')) { rows.add(el); break; }
                    el = el.parentElement;
                }
            });
            return [...rows];
        },

        getTorrentLinks(root = document) {
            return [...root.querySelectorAll('posterhoverpopover a[href*="/torrents/"]')]
                .filter(a => /\/torrents\/[a-f0-9]{20,}/.test(a.href));
        },

        getTorrentTitle(a) {
            return a.querySelector('span')?.textContent?.trim() || a.textContent?.trim() || '';
        },

        // Trouver le bouton download dans une ligne
        getDownloadBtn(row) {
            return row.querySelector('button[data-slot="base"] .i-heroicons\\:arrow-down-tray')?.closest('button')
                || row.querySelector('button:has(.i-heroicons\\:arrow-down-tray)')
                || [...row.querySelectorAll('button')].find(b => b.querySelector('[class*="arrow-down"]'));
        },

        parseRow(row) {
            const desktop = row.querySelector('.lg\\:grid'); if (!desktop) return null;
            const titleSpan = desktop.querySelector('posterhoverpopover a span'); if (!titleSpan) return null;
            const rawName = titleSpan.textContent.trim(); if (rawName.length < 4) return null;
            const linkEl   = desktop.querySelector('posterhoverpopover a[href*="/torrents/"]');
            const hash     = Utils.extractHash(linkEl?.href);
            const langBadge= desktop.querySelector('.min-w-0 div span');
            const langText = langBadge?.textContent?.trim() || '';
            const sizeEl   = desktop.querySelector('.w-20');
            const sizeGB   = sizeEl ? Utils.parseSizeGB(sizeEl.textContent) : 0;
            const ageEl    = desktop.querySelector('.w-14');
            const ageText  = ageEl?.textContent?.trim() || '';
            const catEl    = desktop.querySelector('a[href*="cat="]');
            const subCat   = catEl?.querySelector('span:last-child')?.textContent?.trim() || '';
            const dlBtn    = DOM.getDownloadBtn(row);
            return { el:row, rawName, langText, sizeGB, ageText, subCat, hash, linkHref:linkEl?.href, dlBtn };
        },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑧ SCANNER DE LIGNES
    // ═══════════════════════════════════════════════════════════════════════════
    const Scanner = (() => {
        const cache = new WeakMap();

        function get(row) {
            if (cache.has(row)) return cache.get(row);
            const raw = DOM.parseRow(row);
            if (!raw) { cache.set(row, null); return null; }

            const { rawName, langText, sizeGB, ageText, subCat, hash, linkHref, dlBtn } = raw;
            const yearM    = rawName.match(P.YEAR);
            const year     = yearM ? parseInt(yearM[1]) : null;
            const seasonM  = rawName.match(P.SEASON_RE);
            const season   = seasonM ? parseInt(seasonM[1]) : null;
            const isInteg  = /\b(INTEGRALE|Integrale|COMPLETE)\b/i.test(rawName);

            const qualities = Object.entries(P.QUALITY)
                .filter(([, re]) => re.test(rawName)).map(([k]) => k);

            const languages = [];
            for (const [k, re] of Object.entries(P.LANGUAGE_BADGE)) { if (re.test(langText)) languages.push(k); }
            if (!languages.length) {
                for (const [k, re] of Object.entries(P.LANGUAGE_NAME)) { if (re.test(rawName)) languages.push(k); }
            }

            let type = P.SUBCAT_TYPE[subCat] || 'Film';
            if (type === 'Film') {
                if (P.TYPE['Anime'].test(rawName)) type = 'Anime';
                else if (P.TYPE['Série'].test(rawName)) type = 'Série';
            }

            const ageMin = parseInt(ageText) || 0;
            const isNew  = ageMin < CFG.NEW_HOURS * 60;

            const data = { el:row, rawName, year, season, isInteg, qualities, languages, type, sizeGB, isNew, langText, hash, linkHref, dlBtn };
            cache.set(row, data);
            return data;
        }

        return { get };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑨ CLIENT TMDB
    // ═══════════════════════════════════════════════════════════════════════════
    const TMDB = (() => {
        function _req(endpoint, params = {}) {
            return new Promise((res, rej) => {
                const qp = new URLSearchParams({ api_key: CFG.TMDB_API_KEY, language: CFG.LANGUAGE, ...params });
                GM_xmlhttpRequest({
                    method: 'GET', url: `${CFG.TMDB_BASE}${endpoint}?${qp}`, timeout: 7000,
                    onload : r => { try { res(JSON.parse(r.responseText)); } catch(e) { rej(e); } },
                    onerror: rej, ontimeout: () => rej(new Error('TMDB timeout')),
                });
            });
        }

        function _best(results, cleanTitle, year) {
            if (!results?.length) return null;
            const withPoster = results.filter(r => r.poster_path);
            const pool = withPoster.length ? withPoster : results;
            const scored = pool.map(r => {
                const rt = (r.title||r.name||'').toLowerCase(), qt = cleanTitle.toLowerCase();
                let score = 0;
                if (rt === qt) score += 100;
                else if (rt.includes(qt) || qt.includes(rt)) score += 50;
                else {
                    const rs = new Set(rt.split(/\s+/)), qs = qt.split(/\s+/);
                    score += (qs.filter(w => rs.has(w)).length / Math.max(rs.size, qs.length)) * 40;
                }
                if (year && (r.release_date||r.first_air_date||'').startsWith(String(year))) score += 20;
                if (r.poster_path) score += 5;
                return { r, score };
            });
            scored.sort((a, b) => b.score - a.score);
            return scored[0]?.r || null;
        }

        async function search(rawTitle, isSeries, year) {
            const { title } = TitleParser.parse(rawTitle);
            if (!title || title.length < 2) return null;
            const ck     = `${title}|${isSeries}|${year}`;
            const cached = Cache.get(ck);
            if (cached !== null) { log.i('Cache hit:', ck); return cached; }

            try {
                const type = isSeries ? 'tv' : 'movie';
                const r1   = await _req(`/search/${type}`, { query: title, ...(year ? { [isSeries ? 'first_air_date_year' : 'year']: year } : {}) });
                let b      = _best(r1.results, title, year);

                if (!b && year) { const r2=await _req(`/search/${type}`,{query:title}); b=_best(r2.results,title,year); }
                if (!b) {
                    const r3=await _req('/search/multi',{query:title});
                    b=_best((r3.results||[]).filter(r=>r.media_type==='movie'||r.media_type==='tv'),title,year);
                }
                if (b && !b.overview) {
                    const r4=await _req(`/${b.media_type||type}/${b.id}`,{language:CFG.FALLBACK_LANG});
                    if (r4?.overview) b.overview=r4.overview;
                }
                if (!b) { Cache.set(ck, null); return null; }

                const detail = await _req(`/${isSeries?'tv':'movie'}/${b.id}`,{append_to_response:'images'});
                const data   = _build(b, detail, isSeries);
                Cache.set(ck, data);
                return data;
            } catch(e) { log.e('TMDB error:', e); return null; }
        }

        function _build(item, d, isSeries) {
            const title   = item.title||item.name||d?.title||d?.name||'—';
            const year    = (item.release_date||item.first_air_date||'').slice(0, 4);
            const overview= d?.overview||item.overview||'';
            const rating  = d?.vote_average??item.vote_average??0;
            const votes   = d?.vote_count??item.vote_count??0;
            const genres  = (d?.genres||[]).map(g=>g.name).slice(0, 4);
            const poster  = item.poster_path ? `${CFG.IMG_BASE}w342${item.poster_path}` : null;
            const posterHD= item.poster_path ? `${CFG.IMG_BASE}w500${item.poster_path}` : null;
            const bds     = d?.images?.backdrops||[];
            const bdPath  = bds.length ? bds.sort((a,b)=>b.vote_average-a.vote_average)[0].file_path : (item.backdrop_path||d?.backdrop_path);
            const backdrop= bdPath ? `${CFG.IMG_BASE}w1280${bdPath}` : null;
            const runtime = d?.runtime ? `${Math.floor(d.runtime/60)}h${d.runtime%60?d.runtime%60+'m':''}` : (d?.episode_run_time?.[0]?`~${d.episode_run_time[0]} min/ép.`:null);
            const seasons = isSeries ? (d?.number_of_seasons??null) : null;
            const tagline = d?.tagline||null;
            const tmdbUrl = `https://www.themoviedb.org/${isSeries?'tv':'movie'}/${item.id}`;
            return { title, year, overview, rating, votes, genres, poster, posterHD, backdrop, runtime, seasons, tagline, tmdbUrl, isSeries, id:item.id };
        }

        return { search };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑩ ALLDEBRID API
    // ═══════════════════════════════════════════════════════════════════════════
    const AllDebrid = {
        // Ajouter un magnet à AllDebrid
        uploadMagnet(magnetUrl) {
            return new Promise((resolve, reject) => {
                if (!CFG.ALLDEBRID_KEY || CFG.ALLDEBRID_KEY === 'VOTRE_CLE_ALLDEBRID_ICI') {
                    reject(new Error('Clé AllDebrid non configurée'));
                    return;
                }
                const url = `${CFG.ALLDEBRID_BASE}/magnet/upload?agent=${CFG.ALLDEBRID_AGENT}&apikey=${CFG.ALLDEBRID_KEY}&magnets[]=${encodeURIComponent(magnetUrl)}`;
                GM_xmlhttpRequest({
                    method : 'GET',
                    url,
                    timeout: 8000,
                    onload : r => {
                        try {
                            const data = JSON.parse(r.responseText);
                            if (data.status === 'success') resolve(data.data);
                            else reject(new Error(data.error?.message || 'Erreur AllDebrid'));
                        } catch(e) { reject(e); }
                    },
                    onerror  : () => reject(new Error('Erreur réseau AllDebrid')),
                    ontimeout: () => reject(new Error('Timeout AllDebrid')),
                });
            });
        },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑪ POPUP TMDB UI
    //     Nouveautés v5 :
    //       • Bouton "Télécharger" — clic sur le btn C411 original
    //       • Bouton "Copier le hash"
    //       • Bouton "Envoyer à AllDebrid"
    // ═══════════════════════════════════════════════════════════════════════════
    const PopupUI = (() => {
        let el = null, visible = false, rafId = null;
        let tx = 0, ty = 0, cx = 0, cy = 0;
        let locked = false; // ← FIX v5.1 : popup gelé quand la souris est dessus
        // Contexte du torrent survolé
        let _ctx = { hash: null, title: '', dlBtn: null, linkHref: null };

        // ── CSS ──────────────────────────────────────────────────────────────
        function injectCSS() {
            if (document.getElementById('c411-popup-css')) return;
            const s = document.createElement('style'); s.id = 'c411-popup-css';
            s.textContent = `
                #tmdb-pro-popup*,#tmdb-pro-popup *::before,#tmdb-pro-popup *::after{box-sizing:border-box;margin:0;padding:0;font-family:'Segoe UI',system-ui,sans-serif}
                #tmdb-pro-popup{position:fixed;z-index:2147483647;width:${CFG.POPUP_W}px;pointer-events:none;opacity:0;transform:scale(.93) translateY(7px);transition:opacity 210ms cubic-bezier(.16,1,.3,1),transform 210ms cubic-bezier(.16,1,.3,1);will-change:transform,opacity;filter:drop-shadow(0 24px 60px rgba(0,0,0,.8)) drop-shadow(0 4px 12px rgba(0,0,0,.5))}
                #tmdb-pro-popup.--visible{opacity:1;transform:scale(1) translateY(0)}
                .tmdb-card{position:relative;overflow:hidden;border-radius:14px;background:#0c0e10;border:1px solid rgba(255,255,255,.07);display:flex;min-height:${CFG.POPUP_H}px;max-height:380px}
                .tmdb-backdrop-bg{position:absolute;inset:0;background-size:cover;background-position:center 20%;filter:brightness(.2) saturate(1.5);z-index:0;transition:background-image 300ms}
                .tmdb-backdrop-bg::after{content:'';position:absolute;inset:0;background:linear-gradient(to right,rgba(12,14,16,.97) 38%,rgba(12,14,16,.2) 100%),linear-gradient(to top,rgba(12,14,16,.9) 0%,transparent 55%)}
                .tmdb-poster-col{position:relative;z-index:1;flex:0 0 150px;overflow:hidden}
                .tmdb-poster-img{width:100%;height:100%;object-fit:cover;display:block;opacity:0;background:#181a1e;transition:opacity 280ms}
                .tmdb-poster-img.--ok{opacity:1}
                .tmdb-poster-fallback{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#16213e);gap:6px;color:rgba(255,255,255,.2);font-size:10px}
                .tmdb-poster-shadow{position:absolute;top:0;right:0;width:55px;height:100%;z-index:2;background:linear-gradient(to right,transparent,#0c0e10)}
                .tmdb-info-col{position:relative;z-index:1;flex:1;padding:18px 20px 16px 14px;display:flex;flex-direction:column;gap:7px;overflow:hidden}
                .tmdb-badge{display:inline-flex;align-items:center;gap:4px;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:2px 7px;border-radius:4px;width:fit-content;color:#fff}
                .tmdb-badge.--movie{background:#e50914} .tmdb-badge.--serie{background:#1a6efa} .tmdb-badge.--anime{background:#c026d3}
                .tmdb-title{font-size:17px;font-weight:700;color:#fff;line-height:1.25;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
                .tmdb-tl{font-size:10.5px;color:rgba(255,255,255,.32);font-style:italic;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
                .tmdb-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
                .tmdb-mi{font-size:11.5px;color:rgba(255,255,255,.48);display:flex;align-items:center;gap:3px}
                .tmdb-sep{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.18)}
                .tmdb-rat{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);font-size:12px;font-weight:700;color:#fff}
                .tmdb-stars{display:inline-flex;gap:1px;font-size:8px;line-height:1}
                .tmdb-votes{font-size:9.5px;font-weight:400;color:rgba(255,255,255,.3);margin-left:2px}
                .tmdb-genres{display:flex;flex-wrap:wrap;gap:4px}
                .tmdb-genre{font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.58);white-space:nowrap}
                .tmdb-syn{font-size:11.5px;line-height:1.65;color:rgba(255,255,255,.52);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;flex:1}
                .tmdb-foot{display:flex;align-items:center;justify-content:space-between;padding-top:7px;border-top:1px solid rgba(255,255,255,.05);margin-top:auto}
                .tmdb-logo{font-size:9px;letter-spacing:.07em;color:rgba(255,255,255,.18);display:flex;align-items:center;gap:3px}
                .tmdb-logo-dot{width:4px;height:4px;border-radius:50%;background:#01b4e4}
                .tmdb-sk{background:linear-gradient(90deg,rgba(255,255,255,.03) 25%,rgba(255,255,255,.08) 50%,rgba(255,255,255,.03) 75%);background-size:200% 100%;animation:tmdb-sh 1.4s infinite;border-radius:4px}
                @keyframes tmdb-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}
                .tmdb-err-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;color:rgba(255,255,255,.25);font-size:12px;text-align:center;padding:20px}
                .tmdb-link-active{outline:2px solid rgba(1,180,228,.5)!important;outline-offset:2px!important;border-radius:3px!important}
                /* ── Toast global ── */
                .c411-toast{position:fixed;bottom:22px;right:22px;z-index:2147483647;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;color:#fff;pointer-events:none;opacity:0;transform:translateY(6px);transition:all 220ms cubic-bezier(.16,1,.3,1);font-family:'Segoe UI',system-ui,sans-serif}
                .c411-toast.--show{opacity:1;transform:translateY(0)}
                .c411-toast.--ok{background:#065f46;border:1px solid #34d399}
                .c411-toast.--err{background:#7f1d1d;border:1px solid #f87171}
                .c411-toast.--info{background:#1e3a5f;border:1px solid #60a5fa}
                /* ── Boutons inline dans les lignes du tableau ── */
                .c411-row-btns{display:inline-flex;align-items:center;gap:4px;margin-top:4px;flex-wrap:nowrap}
                .c411-rbtn{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:9.5px;font-weight:600;letter-spacing:.03em;cursor:pointer;border:1px solid;transition:all 110ms;white-space:nowrap;line-height:1.5;user-select:none}
                .c411-rbtn:active{transform:scale(.95)}
                .c411-rbtn.--dl{background:rgba(52,211,153,.08);border-color:rgba(52,211,153,.25);color:rgba(52,211,153,.8)}
                .c411-rbtn.--dl:hover{background:rgba(52,211,153,.2);border-color:#34d399;color:#34d399}
                .c411-rbtn.--hash{background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.12);color:rgba(255,255,255,.4)}
                .c411-rbtn.--hash:hover{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.25);color:rgba(255,255,255,.8)}
                .c411-rbtn.--ad{background:rgba(251,146,60,.07);border-color:rgba(251,146,60,.22);color:rgba(251,146,60,.75)}
                .c411-rbtn.--ad:hover{background:rgba(251,146,60,.18);border-color:#fb923c;color:#fb923c}
                .c411-rbtn.--ad.--spin{opacity:.55;pointer-events:none}
                .c411-rbtn.--ad.--ok{background:rgba(52,211,153,.12);border-color:#34d399;color:#34d399;pointer-events:none}
                .c411-rbtn.--ad.--err{background:rgba(239,68,68,.1);border-color:#ef4444;color:#f87171}
            `;
            document.head.appendChild(s);
        }

        // ── Toast — défini dans Deco, accessible globalement ──────────────────
        function toast(msg, type = 'ok', ms = 2600) { Deco.toast(msg, type, ms); }

        // ── Helpers de rendu ───────────────────────────────────────────────────
        function stars(r) {
            const v=r/2,f=Math.floor(v),h=v-f>=0.5; let s='';
            for(let i=0;i<5;i++){
                if(i<f)           s+='<span style="color:#f5c518">★</span>';
                else if(i===f&&h) s+='<span style="color:#f5c518">⯨</span>';
                else              s+='<span style="color:rgba(255,255,255,.14)">★</span>';
            }
            return s;
        }
        function rc(r)      { if(r>=7.5)return'#4caf50';if(r>=6)return'#ff9800';if(r>=5)return'#ff5722';return'#9e9e9e'; }
        function trunc(t,m) { if(!t||t.length<=m)return t||''; return t.slice(0,t.lastIndexOf(' ',m))+'…'; }
        function fv(n)      { if(!n)return''; if(n>=1000)return(n/1000).toFixed(1)+'k'; return n; }

        // ── Rendu skeleton ─────────────────────────────────────────────────────
        function renderSkeleton() {
            el.innerHTML = `
                <div class="tmdb-card">
                    <div class="tmdb-backdrop-bg"></div>
                    <div class="tmdb-poster-col"><div class="tmdb-sk" style="width:100%;height:100%"></div></div>
                    <div class="tmdb-info-col" style="gap:10px">
                        <div class="tmdb-sk" style="height:10px;width:55px;border-radius:20px"></div>
                        <div class="tmdb-sk" style="height:19px;width:80%"></div>
                        <div class="tmdb-sk" style="height:11px;width:45%"></div>
                        <div class="tmdb-sk" style="height:11px;width:95%;margin-top:4px"></div>
                        <div class="tmdb-sk" style="height:11px;width:80%"></div>
                        <div class="tmdb-sk" style="height:11px;width:68%"></div>
                    </div>
                </div>`;
        }

        // ── Rendu données TMDB ─────────────────────────────────────────────────
        function renderData(data) {
            const syn    = trunc(data.overview, CFG.MAX_SYNOPSIS);
            const rn     = parseFloat(data.rating?.toFixed(1)) || 0;
            const rcol   = rc(rn);
            const bdgCls = data.isSeries ? '--serie' : '--movie';
            const bdgTxt = data.isSeries ? '⬡ Série' : '◈ Film';

            el.innerHTML = `
                <div class="tmdb-card">
                    <div class="tmdb-backdrop-bg" id="tmdb-bd"></div>
                    <div class="tmdb-poster-col">
                        ${data.poster ? `<img class="tmdb-poster-img" id="tmdb-img" alt="">` : `<div class="tmdb-poster-fallback"><svg width="28" height="28" viewBox="0 0 24 24" fill="rgba(255,255,255,.3)"><path d="M4 4h16v16H4z" opacity=".2"/><path d="M8 7v10l8-5z"/></svg><span>No poster</span></div>`}
                        <div class="tmdb-poster-shadow"></div>
                    </div>
                    <div class="tmdb-info-col">
                        <span class="tmdb-badge ${bdgCls}">${bdgTxt}</span>
                        <div class="tmdb-title">${data.title}</div>
                        ${data.tagline ? `<div class="tmdb-tl">${data.tagline}</div>` : ''}
                        <div class="tmdb-meta">
                            ${data.year ? `<span class="tmdb-mi">📅 ${data.year}</span>` : ''}
                            ${data.runtime ? `<span class="tmdb-sep"></span><span class="tmdb-mi">⏱ ${data.runtime}</span>` : ''}
                            ${data.seasons ? `<span class="tmdb-sep"></span><span class="tmdb-mi">🗂 ${data.seasons} saison${data.seasons>1?'s':''}</span>` : ''}
                            ${rn > 0 ? `<span class="tmdb-rat" style="color:${rcol}"><span class="tmdb-stars">${stars(rn)}</span>${rn}/10<span class="tmdb-votes">(${fv(data.votes)})</span></span>` : ''}
                        </div>
                        ${data.genres?.length ? `<div class="tmdb-genres">${data.genres.map(g=>`<span class="tmdb-genre">${g}</span>`).join('')}</div>` : ''}
                        ${syn ? `<p class="tmdb-syn">${syn}</p>` : `<p class="tmdb-syn" style="opacity:.2;font-style:italic">Aucun synopsis.</p>`}
                        <div class="tmdb-foot">
                            <span class="tmdb-logo"><span class="tmdb-logo-dot"></span>TMDB</span>
                            ${data.tmdbUrl ? `<a href="${data.tmdbUrl}" target="_blank" rel="noopener" style="font-size:9.5px;color:rgba(1,180,228,.5);text-decoration:none" onclick="event.stopPropagation()">Voir sur TMDB →</a>` : ''}
                        </div>
                    </div>
                </div>`;

            if (data.poster) {
                const img = el.querySelector('#tmdb-img'), tmp = new Image();
                tmp.onload = () => { if (img) { img.src = data.posterHD || data.poster; img.classList.add('--ok'); } };
                tmp.src = data.poster;
            }
            if (data.backdrop) {
                const bd = el.querySelector('#tmdb-bd'), tmp = new Image();
                tmp.onload = () => { if (bd) bd.style.backgroundImage = `url('${data.backdrop}')`; };
                tmp.src = data.backdrop;
            }
        }

        // ── Rendu erreur ───────────────────────────────────────────────────────
        function renderError(title) {
            el.innerHTML = `
                <div class="tmdb-card">
                    <div class="tmdb-backdrop-bg"></div>
                    <div class="tmdb-info-col" style="width:100%">
                        <div class="tmdb-err-state">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <span>Aucun résultat</span><span style="font-size:10px;opacity:.4">${title}</span>
                        </div>
                    </div>
                </div>`;
        }

        // ── Positionnement ─────────────────────────────────────────────────────
        function pos(mx, my) {
            const pw=CFG.POPUP_W, ph=el.offsetHeight||CFG.POPUP_H, vw=window.innerWidth, vh=window.innerHeight;
            let x=mx+CFG.MOUSE_OFFSET_X, y=my+CFG.MOUSE_OFFSET_Y;
            if(x+pw>vw-12) x=mx-pw-CFG.MOUSE_OFFSET_X; if(x<12)x=12;
            if(y+ph>vh-12) y=vh-ph-12; if(y<12)y=12;
            return {x,y};
        }

        function animate() {
            if (!visible) return;
            if (!locked) {
                cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
                el.style.left = cx + 'px'; el.style.top = cy + 'px';
            }
            rafId = requestAnimationFrame(animate);
        }

        // ── Créer le DOM popup (une seule fois) ────────────────────────────────
        function _ensureEl() {
            if (el) return;
            injectCSS();
            el = document.createElement('div');
            el.id = 'tmdb-pro-popup';
            document.body.appendChild(el);
            el.addEventListener('mouseenter', () => { locked = true;  cancelAnimationFrame(rafId); });
            el.addEventListener('mouseleave', () => { locked = false; if (visible) rafId = requestAnimationFrame(animate); });
        }

        // ── API publique ───────────────────────────────────────────────────────
        function setContext(ctx) { _ctx = { ...ctx }; }
        function show(mx, my)    { _ensureEl(); const{x,y}=pos(mx,my); tx=x;ty=y;cx=x;cy=y; el.style.left=x+'px';el.style.top=y+'px'; el.classList.add('--visible'); visible=true; locked=false; cancelAnimationFrame(rafId); rafId=requestAnimationFrame(animate); }
        function hide()          { if(!el)return; el.classList.remove('--visible'); visible=false; locked=false; cancelAnimationFrame(rafId); }
        function move(mx, my)    { if(!visible||locked)return; const{x,y}=pos(mx,my); tx=x; ty=y; }
        function setLoading()    { _ensureEl(); renderSkeleton(); }
        function setData(d)      { if(el) renderData(d); }
        function setError(t)     { if(el) renderError(t); }
        function isShown()       { return visible; }

        return { setContext, show, hide, move, setLoading, setData, setError, isShown };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑫ STATE FILTRES
    // ═══════════════════════════════════════════════════════════════════════════
    const State = (() => {
        const DEF = () => ({
            year:'', text:'',
            qualities : new Set(),
            languages : new Set(),
            types     : new Set(),
            seasons   : new Set(),  // ← NOUVEAU : saisons sélectionnées
            seasonMin : 0,          // ← NOUVEAU : plage min (0=tous)
            seasonMax : 20,
            sizeMin   : 0,
            sizeMax   : CFG.MAX_SIZE_GB,
        });
        let s=DEF(); const fs=new Set();
        const notify=()=>fs.forEach(fn=>fn(s));
        return {
            get:()=>s, sub:fn=>{fs.add(fn);return()=>fs.delete(fn);},
            update:p=>{Object.assign(s,p);notify();},
            toggle:(k,v)=>{const t=new Set(s[k]);t.has(v)?t.delete(v):t.add(v);Object.assign(s,{[k]:t});notify();},
            reset:()=>{s=DEF();notify();},
            empty:()=>!s.year&&!s.text&&!s.qualities.size&&!s.languages.size&&!s.types.size&&!s.seasons.size&&s.seasonMin===0&&s.seasonMax===20&&s.sizeMin===0&&s.sizeMax>=CFG.MAX_SIZE_GB,
            ser:()=>JSON.stringify({year:s.year,text:s.text,qualities:[...s.qualities],languages:[...s.languages],types:[...s.types],seasons:[...s.seasons],seasonMin:s.seasonMin,seasonMax:s.seasonMax,sizeMin:s.sizeMin,sizeMax:s.sizeMax}),
            deser:str=>{try{const o=JSON.parse(str);s={year:o.year||'',text:o.text||'',qualities:new Set(o.qualities||[]),languages:new Set(o.languages||[]),types:new Set(o.types||[]),seasons:new Set(o.seasons||[]),seasonMin:o.seasonMin??0,seasonMax:o.seasonMax??20,sizeMin:o.sizeMin??0,sizeMax:o.sizeMax??CFG.MAX_SIZE_GB};notify();}catch{}},
        };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑬ STOCKAGE FILTRES
    // ═══════════════════════════════════════════════════════════════════════════
    const Store = {
        save()        { try{GM_setValue(CFG.STORAGE_KEY,State.ser());}catch{} },
        load()        { try{const r=GM_getValue(CFG.STORAGE_KEY);if(r)State.deser(r);}catch{} },
        presets()     { try{return JSON.parse(GM_getValue(CFG.PRESET_KEY)||'{}');}catch{return{};} },
        savePreset(n) { const p=this.presets();p[n]=State.ser();try{GM_setValue(CFG.PRESET_KEY,JSON.stringify(p));}catch{} },
        loadPreset(n) { const p=this.presets();if(p[n])State.deser(p[n]); },
        delPreset(n)  { const p=this.presets();delete p[n];try{GM_setValue(CFG.PRESET_KEY,JSON.stringify(p));}catch{} },
        listPresets() { return Object.keys(this.presets()); },
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑭ MOTEUR DE FILTRAGE
    // ═══════════════════════════════════════════════════════════════════════════
    const Engine = (() => {
        let rows=[],visible=0,cbs=new Set(),rafId=null;
        const onCount=fn=>cbs.add(fn);

        function match(data, f) {
            // ── Texte ────────────────────────────────────────────────────────────
            if (f.text && !data.rawName.toLowerCase().includes(f.text.toLowerCase())) return false;
            // ── Année ────────────────────────────────────────────────────────────
            if (f.year) { const yr=parseInt(f.year); if(!isNaN(yr)&&data.year!==yr) return false; }
            // ── Qualité ──────────────────────────────────────────────────────────
            if (f.qualities.size && !data.qualities.some(q=>f.qualities.has(q))) return false;
            // ── Langue ───────────────────────────────────────────────────────────
            if (f.languages.size && !data.languages.some(l=>f.languages.has(l))) return false;
            // ── Type ─────────────────────────────────────────────────────────────
            if (f.types.size && !f.types.has(data.type)) return false;
            // ── Saisons spécifiques (boutons) ────────────────────────────────────
            if (f.seasons.size) {
                if (f.seasons.has('Intégrale')) {
                    // L'option "Intégrale" inclut les torrents marqués comme tels OU sans saison détectée
                    if (!data.isInteg) return false;
                } else {
                    // Filtre par numéro de saison
                    if (data.season === null) return false;
                    if (!f.seasons.has(String(data.season).padStart(2,'0'))) return false;
                }
            }
            // ── Plage de saisons (slider) ────────────────────────────────────────
            if (f.seasonMin > 0 || f.seasonMax < 20) {
                if (data.type === 'Série' || data.type === 'Anime') {
                    if (data.season !== null) {
                        if (data.season < f.seasonMin || data.season > f.seasonMax) return false;
                    }
                }
            }
            // ── Taille ───────────────────────────────────────────────────────────
            if (data.sizeGB > 0) {
                if (data.sizeGB < f.sizeMin) return false;
                if (f.sizeMax < CFG.MAX_SIZE_GB && data.sizeGB > f.sizeMax) return false;
            }
            return true;
        }

        function _run() {
            const f=State.get(); let vis=0;
            rows.forEach(row=>{
                const data=Scanner.get(row); if(!data)return;
                const show=match(data,f);
                if(show){vis++;if(row.style.display==='none'){row.style.display='';row.style.animation='c411f-fadein 180ms ease forwards';}}
                else row.style.display='none';
            });
            visible=vis; cbs.forEach(fn=>fn(vis,rows.length));
        }

        const dRun=Utils.debounce(_run,CFG.DEBOUNCE_MS);
        return {
            apply:(im=false)=>{cancelAnimationFrame(rafId);if(im)rafId=requestAnimationFrame(_run);else dRun();},
            setRows:r=>{rows=r;}, addRows:r=>{rows=[...new Set([...rows,...r])];},
            stats:()=>({visible,total:rows.length}), onCount,
        };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑮ DÉCORATEUR — Tags visuels + Boutons inline dans chaque ligne
    // ═══════════════════════════════════════════════════════════════════════════
    const Deco = (() => {
        const done = new WeakSet();

        const COLORS = {
            '4K / UHD'  :['#4c1d95','#a78bfa'], '1080p':['#1e3a8a','#60a5fa'], '720p':['#164e63','#22d3ee'],
            'BluRay'    :['#581c87','#c084fc'],  'WEB-DL':['#14532d','#4ade80'], 'WEBRip':['#064e3b','#34d399'],
            'REMUX'     :['#78350f','#fbbf24'],  'HDTV':['#1e3a5f','#93c5fd'],  '480p':['#27272a','#71717a'],
            'HDR'       :['#431407','#fb923c'],
            'TrueFrench':['#7f1d1d','#f87171'],  'VF':['#7c1d1d','#fca5a5'],
            'VOSTFR'    :['#7c2d12','#fb923c'],  'MULTI':['#713f12','#fbbf24'], 'VO':['#14532d','#86efac'],
            'Film'      :['#1e3a5f','#60a5fa'],  'Série':['#134e4a','#2dd4bf'],
            'Anime'     :['#831843','#f472b6'],  'Documentaire':['#3f3f46','#a1a1aa'],
            'Spectacle' :['#3b0764','#d8b4fe'],  'Émission TV':['#1c1917','#78716c'],
            'NEW'       :['#052e16','#00e676'],
        };
        const tag = (l, [bg, b]) => `<span class="c411f-tag" style="background:${bg};border-color:${b}">${l}</span>`;

        // ── Toast (réutilisé par les boutons inline) ──────────────────────────
        function toast(msg, type = 'ok', ms = 2600) {
            let t = document.getElementById('c411-toast-el');
            if (!t) { t=document.createElement('div');t.id='c411-toast-el';t.className='c411-toast';document.body.appendChild(t); }
            t.textContent = msg; t.className = `c411-toast --${type}`;
            requestAnimationFrame(() => t.classList.add('--show'));
            clearTimeout(t._t);
            t._t = setTimeout(() => t.classList.remove('--show'), ms);
        }

        // ── Logique AllDebrid (partagée) ──────────────────────────────────────
        async function sendToAllDebrid(hash, rawName, btn) {
            if (!CFG.ALLDEBRID_KEY || CFG.ALLDEBRID_KEY === 'VOTRE_CLE_ALLDEBRID_ICI') {
                toast('⚠ Clé AllDebrid non configurée dans CFG', 'err', 4000);
                return;
            }
            btn.classList.add('--spin'); btn.textContent = '⏳';
            try {
                const magnet = Utils.buildMagnet(hash, rawName);
                const result = await AllDebrid.uploadMagnet(magnet);
                const name   = result?.magnets?.[0]?.name || rawName;
                btn.classList.remove('--spin'); btn.classList.add('--ok');
                btn.textContent = '✓';
                btn.title = `✓ Ajouté : ${name}`;
                toast(`✓ "${name.slice(0,40)}" ajouté à AllDebrid`, 'ok', 3500);
            } catch(err) {
                btn.classList.remove('--spin'); btn.classList.add('--err');
                btn.textContent = '✗';
                toast(`✗ AllDebrid : ${err.message}`, 'err', 4000);
                setTimeout(() => { btn.classList.remove('--err'); btn.textContent = '🟠'; btn.title = 'Envoyer à AllDebrid'; }, 3500);
            }
        }

        // ── Injecter les boutons inline sous les badges d'une ligne ──────────
        function addRowButtons(row, data) {
            const desktop = row.querySelector('.lg\\:grid .min-w-0');
            if (!desktop) return;

            // La zone des badges C411 existants (langue, etc.)
            const badgeZone = desktop.querySelector('div.flex.items-center.gap-1\\.5');
            if (!badgeZone) return;

            // Créer le conteneur de boutons
            const btns = document.createElement('div');
            btns.className = 'c411-row-btns';

            const hasAD = CFG.ALLDEBRID_KEY && CFG.ALLDEBRID_KEY !== 'VOTRE_CLE_ALLDEBRID_ICI';

            // ── Bouton Télécharger ──────────────────────────────────────────────
            const dlBtn = document.createElement('button');
            dlBtn.className = 'c411-rbtn --dl';
            dlBtn.title     = 'Télécharger le torrent';
            dlBtn.innerHTML = '⬇ DL';
            dlBtn.addEventListener('click', e => {
                e.stopPropagation(); e.preventDefault();
                const nativeDl = DOM.getDownloadBtn(row);
                if (nativeDl) {
                    nativeDl.click();
                    toast('✓ Téléchargement lancé', 'ok');
                } else if (data.linkHref) {
                    window.open(data.linkHref, '_blank');
                } else {
                    toast('⚠ Bouton introuvable', 'err');
                }
            });

            // ── Bouton Hash ─────────────────────────────────────────────────────
            const hashBtn = document.createElement('button');
            hashBtn.className = 'c411-rbtn --hash';
            hashBtn.title     = data.hash ? `Copier le hash : ${data.hash}` : 'Hash indisponible';
            hashBtn.innerHTML = '# Hash';
            if (!data.hash) hashBtn.style.opacity = '.35';
            hashBtn.addEventListener('click', e => {
                e.stopPropagation(); e.preventDefault();
                if (!data.hash) { toast('⚠ Hash introuvable', 'err'); return; }
                const ok = Utils.copyToClipboard(data.hash);
                if (ok) {
                    toast(`✓ Hash copié : ${data.hash.slice(0,12)}…`, 'ok');
                    hashBtn.textContent = '✓ Copié';
                    setTimeout(() => { hashBtn.textContent = '# Hash'; }, 2000);
                } else {
                    toast('⚠ Copie impossible', 'err');
                }
            });

            // ── Bouton AllDebrid ────────────────────────────────────────────────
            const adBtn = document.createElement('button');
            adBtn.className = 'c411-rbtn --ad';
            adBtn.title     = hasAD ? 'Envoyer à AllDebrid' : 'Clé AllDebrid non configurée';
            adBtn.innerHTML = '🟠 AD';
            if (!hasAD) adBtn.style.opacity = '.35';
            if (!data.hash) adBtn.style.opacity = '.35';
            adBtn.addEventListener('click', async e => {
                e.stopPropagation(); e.preventDefault();
                if (!data.hash) { toast('⚠ Hash introuvable', 'err'); return; }
                await sendToAllDebrid(data.hash, data.rawName, adBtn);
            });

            btns.append(dlBtn, hashBtn, adBtn);

            // Insérer les boutons juste après la zone badges
            badgeZone.insertAdjacentElement('afterend', btns);
        }

        // ── Décorer une ligne (tags + boutons) ───────────────────────────────
        function decorate(row) {
            if (done.has(row)) return;
            done.add(row);
            const data = Scanner.get(row); if (!data) return;
            const desktop = row.querySelector('.lg\\:grid .min-w-0'); if (!desktop) return;

            // Tags visuels
            let wrap = desktop.querySelector('.c411f-tags-wrap');
            if (!wrap) {
                wrap = document.createElement('span'); wrap.className = 'c411f-tags-wrap';
                const pp = desktop.querySelector('posterhoverpopover');
                if (pp) pp.insertAdjacentElement('afterend', wrap); else desktop.appendChild(wrap);
            }
            const parts = [];
            if (data.isNew)   parts.push(tag('✦ NEW', COLORS['NEW']));
            if (data.type !== 'Film') parts.push(tag(data.type, COLORS[data.type] || COLORS['Film']));
            if (data.season !== null) parts.push(tag(`S${String(data.season).padStart(2,'0')}`, ['#1e293b','#475569']));
            if (data.isInteg) parts.push(tag('Intégrale', ['#1e293b','#7c3aed']));
            data.qualities.slice(0, 2).forEach(q => COLORS[q] && parts.push(tag(q, COLORS[q])));
            const lang = data.languages[0];
            if (lang && COLORS[lang]) parts.push(tag(lang, COLORS[lang]));
            wrap.innerHTML = parts.join('');

            // Boutons d'action inline
            addRowButtons(row, data);
        }

        return { decorate, toast };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑯ UI FILTRES — panneau glassmorphism vert C411
    // ═══════════════════════════════════════════════════════════════════════════
    const FilterUI = (() => {
        let panel=null;

        function injectCSS() {
            if(document.getElementById('c411f-css'))return;
            const s=document.createElement('style');s.id='c411f-css';
            s.textContent=`
                #c411f-panel,#c411f-panel *,#c411f-panel *::before,#c411f-panel *::after{box-sizing:border-box;margin:0;padding:0;font-family:'Inter','Segoe UI',system-ui,sans-serif}
                #c411f-panel{position:relative;margin-bottom:12px;padding:14px 18px 12px;background:rgba(2,17,5,0.96);border:1px solid rgba(52,211,153,0.2);border-radius:12px;backdrop-filter:blur(20px);box-shadow:0 12px 40px rgba(0,0,0,.6),inset 0 1px 0 rgba(52,211,153,.07);animation:c411f-in 260ms cubic-bezier(.16,1,.3,1)}
                @keyframes c411f-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
                #c411f-panel::before{content:'';position:absolute;top:0;left:20px;right:20px;height:1.5px;border-radius:99px;background:linear-gradient(90deg,transparent,rgba(52,211,153,.6),transparent)}
                .c411f-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;flex-wrap:wrap;gap:8px}
                .c411f-logo{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#34d399}
                .c411f-dot{width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 6px #34d399;animation:c411f-pulse 2s infinite}
                @keyframes c411f-pulse{0%,100%{opacity:1}50%{opacity:.25}}
                #c411f-stats{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:rgba(209,250,229,.45);padding:3px 10px;border-radius:6px;background:rgba(0,0,0,.3);border:1px solid rgba(52,211,153,.15);transition:all 200ms}
                #c411f-stats.--on{border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.06)}
                #c411f-stats strong{color:#34d399;font-weight:700}
                .c411f-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px 18px}
                @media(max-width:680px){.c411f-grid{grid-template-columns:1fr}}
                .c411f-grp{display:flex;flex-direction:column;gap:5px}
                .c411f-grp.--full{grid-column:1/-1}
                .c411f-grp-lbl{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(209,250,229,.38)}
                .c411f-input{height:29px;padding:0 10px;width:100%;background:rgba(0,0,0,.4);border:1px solid rgba(52,211,153,.18);border-radius:6px;color:#d1fae5;font-size:12px;outline:none;transition:border-color 140ms,box-shadow 140ms}
                .c411f-input::placeholder{color:rgba(209,250,229,.3)}
                .c411f-input:focus{border-color:#34d399;box-shadow:0 0 0 2px rgba(52,211,153,.12)}
                .c411f-chips{display:flex;flex-wrap:wrap;gap:4px}
                .c411f-chip{padding:3px 9px;border-radius:20px;border:1px solid rgba(52,211,153,.18);background:rgba(52,211,153,.06);color:rgba(209,250,229,.45);font-size:10.5px;font-weight:600;cursor:pointer;user-select:none;transition:all 120ms;white-space:nowrap}
                .c411f-chip:hover{border-color:#34d399;color:#d1fae5;transform:translateY(-1px)}
                .c411f-chip.--on{background:rgba(52,211,153,.22);border-color:#34d399;color:#34d399;box-shadow:0 0 8px rgba(52,211,153,.18)}
                .c411f-chip.--on::before{content:'✓ ';font-size:9px}
                /* Chips saison — style légèrement différent */
                .c411f-chip.--season{font-size:10px;padding:2px 7px;font-family:monospace}
                .c411f-chip.--season.--on{background:rgba(99,102,241,.25);border-color:#818cf8;color:#a5b4fc}
                /* Range taille */
                .c411f-range-wrap{position:relative;padding:14px 0 2px}
                .c411f-track{position:relative;height:3px;background:rgba(255,255,255,.08);border-radius:99px;margin:0 8px}
                .c411f-fill{position:absolute;height:100%;border-radius:99px;background:linear-gradient(90deg,#059669,#34d399)}
                .c411f-range{position:absolute;top:-8px;width:calc(100% + 16px);left:-8px;appearance:none;-webkit-appearance:none;height:20px;background:transparent;pointer-events:none}
                .c411f-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:15px;height:15px;border-radius:50%;background:#34d399;border:2px solid #021a07;cursor:pointer;pointer-events:all;box-shadow:0 0 5px rgba(52,211,153,.5);transition:transform 100ms}
                .c411f-range::-webkit-slider-thumb:hover{transform:scale(1.3)}
                .c411f-range-vals{display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:rgba(209,250,229,.4)}
                .c411f-range-val{color:#34d399;font-weight:700;font-size:11px}
                /* Season range */
                .c411f-srange-wrap{position:relative;padding:10px 0 2px}
                .c411f-srange-track{position:relative;height:3px;background:rgba(255,255,255,.08);border-radius:99px;margin:0 8px}
                .c411f-srange-fill{position:absolute;height:100%;border-radius:99px;background:linear-gradient(90deg,#4f46e5,#818cf8)}
                .c411f-srange-input{position:absolute;top:-8px;width:calc(100% + 16px);left:-8px;appearance:none;-webkit-appearance:none;height:20px;background:transparent;pointer-events:none}
                .c411f-srange-input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#818cf8;border:2px solid #021a07;cursor:pointer;pointer-events:all;box-shadow:0 0 5px rgba(129,140,248,.5)}
                .c411f-srange-vals{display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:rgba(209,250,229,.4)}
                .c411f-srange-val{color:#818cf8;font-weight:700;font-size:11px}
                /* Footer */
                .c411f-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:7px;margin-top:11px;padding-top:9px;border-top:1px solid rgba(52,211,153,.08)}
                .c411f-actions{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
                .c411f-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 11px;border-radius:6px;border:1px solid rgba(52,211,153,.18);background:rgba(52,211,153,.06);color:rgba(209,250,229,.45);font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 120ms}
                .c411f-btn:hover{background:rgba(52,211,153,.14);border-color:#34d399;color:#d1fae5}
                .c411f-btn.--danger{border-color:rgba(239,68,68,.25);color:rgba(239,68,68,.5)}
                .c411f-btn.--danger:hover{background:rgba(239,68,68,.1);border-color:#ef4444;color:#ef4444}
                .c411f-btn.--active{border-color:#34d399;color:#34d399;background:rgba(52,211,153,.12)}
                .c411f-select{height:29px;padding:0 7px;flex:1;min-width:130px;background:rgba(0,0,0,.5);border:1px solid rgba(52,211,153,.18);border-radius:6px;color:#d1fae5;font-size:11px;outline:none;cursor:pointer}
                .c411f-select:focus{border-color:#34d399}
                .c411f-select option{background:#021a07;color:#d1fae5}
                .c411f-preset-wrap{display:flex;align-items:center;gap:4px}
                .c411f-kbd{display:inline-block;padding:1px 4px;border-radius:3px;border:1px solid rgba(52,211,153,.2);background:rgba(0,0,0,.3);font-size:9px;font-family:monospace;color:rgba(52,211,153,.5)}
                .c411f-hints{font-size:9.5px;color:rgba(209,250,229,.18);letter-spacing:.03em}
                .c411f-toggle{background:none;border:none;cursor:pointer;color:rgba(209,250,229,.35);font-size:11px;display:flex;align-items:center;gap:3px;padding:0}
                .c411f-toggle:hover{color:#34d399}
                .c411f-arrow{display:inline-block;transition:transform 200ms;font-size:9px}
                .c411f-toggle.--up .c411f-arrow{transform:rotate(-90deg)}
                #c411f-body{max-height:800px;opacity:1;overflow:hidden;transition:max-height 240ms ease,opacity 180ms ease}
                #c411f-body.--closed{max-height:0;opacity:0}
                /* Tags sur les lignes */
                .c411f-tags-wrap{display:inline-flex;flex-wrap:wrap;gap:2px;margin-left:6px;vertical-align:middle}
                .c411f-tag{display:inline-block;padding:1px 5px;border-radius:3px;border:1px solid;font-size:9px;font-weight:700;letter-spacing:.04em;line-height:1.5;white-space:nowrap;color:#fff;opacity:.9}
                .c411f-tag:hover{opacity:1}
                @keyframes c411f-fadein{from{opacity:0;transform:translateX(-3px)}to{opacity:1;transform:none}}
            `;
            document.head.appendChild(s);
        }

        function buildSizeSlider() {
            const max=CFG.MAX_SIZE_GB, w=document.createElement('div');w.className='c411f-range-wrap';
            w.innerHTML=`<div class="c411f-track"><div class="c411f-fill" id="c411f-sfill"></div><input type="range" class="c411f-range" id="c411f-smin" min="0" max="${max}" value="0" step="0.5"><input type="range" class="c411f-range" id="c411f-smax" min="0" max="${max}" value="${max}" step="0.5"></div><div class="c411f-range-vals"><span>Min : <span class="c411f-range-val" id="c411f-smin-v">0 GB</span></span><span>Max : <span class="c411f-range-val" id="c411f-smax-v">${max} GB</span></span></div>`;
            return w;
        }

        function buildSeasonRangeSlider() {
            const w=document.createElement('div');w.className='c411f-srange-wrap';
            w.innerHTML=`<div class="c411f-srange-track"><div class="c411f-srange-fill" id="c411f-srfill"></div><input type="range" class="c411f-srange-input" id="c411f-srmin" min="1" max="20" value="1" step="1"><input type="range" class="c411f-srange-input" id="c411f-srmax" min="1" max="20" value="20" step="1"></div><div class="c411f-srange-vals"><span>De S<span class="c411f-srange-val" id="c411f-srmin-v">01</span></span><span>À S<span class="c411f-srange-val" id="c411f-srmax-v">20</span></span></div>`;
            return w;
        }

        function buildPanel() {
            const el=document.createElement('div');el.id='c411f-panel';

            const QC=['4K / UHD','1080p','720p','BluRay','WEB-DL','WEBRip','REMUX','HDR','HDTV','DVDRip'];
            const LC=['TrueFrench','VF','VOSTFR','MULTI','VO'];
            const TC=['Film','Série','Anime','Documentaire','Spectacle','Émission TV'];
            // Saisons S01 → S15 + Intégrale
            const SC=[...Array.from({length:15},(_,i)=>String(i+1).padStart(2,'0')),'Intégrale'];

            el.innerHTML=`
                <div class="c411f-hdr">
                    <div class="c411f-logo"><div class="c411f-dot"></div>C411 · Filtres</div>
                    <div style="display:flex;align-items:center;gap:7px">
                        <div id="c411f-stats"><strong id="c411f-count">—</strong> / <span id="c411f-total">—</span> résultats</div>
                        <button class="c411f-toggle" id="c411f-toggle"><span class="c411f-arrow">▼</span><span id="c411f-tlbl">Réduire</span></button>
                    </div>
                </div>
                <div id="c411f-body">
                    <div class="c411f-grid">
                        <div class="c411f-grp">
                            <span class="c411f-grp-lbl">🔍 Recherche libre</span>
                            <input id="c411f-text" class="c411f-input" placeholder="Titre, groupe release…" autocomplete="off">
                        </div>
                        <div class="c411f-grp">
                            <span class="c411f-grp-lbl">📅 Année exacte</span>
                            <input id="c411f-year" class="c411f-input" placeholder="ex : 2024" maxlength="4" inputmode="numeric">
                        </div>
                        <div class="c411f-grp --full">
                            <span class="c411f-grp-lbl">⭐ Qualité vidéo</span>
                            <div class="c411f-chips">${QC.map(q=>`<button class="c411f-chip" data-f="qualities" data-v="${q}">${q}</button>`).join('')}</div>
                        </div>
                        <div class="c411f-grp">
                            <span class="c411f-grp-lbl">🌍 Langue / Doublage</span>
                            <div class="c411f-chips">${LC.map(l=>`<button class="c411f-chip" data-f="languages" data-v="${l}">${l}</button>`).join('')}</div>
                        </div>
                        <div class="c411f-grp">
                            <span class="c411f-grp-lbl">🎬 Type de contenu</span>
                            <div class="c411f-chips">${TC.map(t=>`<button class="c411f-chip" data-f="types" data-v="${t}">${t}</button>`).join('')}</div>
                        </div>
                        <div class="c411f-grp --full">
                            <span class="c411f-grp-lbl">📺 Saison — sélection rapide</span>
                            <div class="c411f-chips">${SC.map(s=>`<button class="c411f-chip --season" data-f="seasons" data-v="${s}">${s==='Intégrale'?'📦 Intégrale':'S'+s}</button>`).join('')}</div>
                        </div>
                        <div class="c411f-grp --full" id="c411f-srange-grp">
                            <span class="c411f-grp-lbl">📺 Saison — plage (ne s'applique que si aucune saison précise sélectionnée)</span>
                        </div>
                        <div class="c411f-grp --full">
                            <span class="c411f-grp-lbl">📦 Taille du fichier</span>
                        </div>
                    </div>
                    <div class="c411f-footer">
                        <div class="c411f-actions">
                            <button id="c411f-reset" class="c411f-btn --danger">↺ Reset <span class="c411f-kbd">Alt+R</span></button>
                            <div class="c411f-preset-wrap">
                                <button id="c411f-psave" class="c411f-btn">💾 Sauvegarder</button>
                                <select id="c411f-psel" class="c411f-select"><option value="">— Preset —</option></select>
                                <button id="c411f-pdel" class="c411f-btn --danger" style="display:none;padding:4px 7px">✕</button>
                            </div>
                        </div>
                        <div class="c411f-hints"><span class="c411f-kbd">Alt+F</span> focus &nbsp;<span class="c411f-kbd">ESC</span> reset texte</div>
                    </div>
                </div>`;

            // Injecter les sliders dans leurs groupes
            const grps = el.querySelectorAll('.c411f-grp');
            el.querySelector('#c411f-srange-grp').appendChild(buildSeasonRangeSlider());
            grps[grps.length - 1].appendChild(buildSizeSlider());

            return el;
        }

        function _sizeUI(min, max) {
            const slMin=panel.querySelector('#c411f-smin'),slMax=panel.querySelector('#c411f-smax');
            const fill=panel.querySelector('#c411f-sfill'),vMin=panel.querySelector('#c411f-smin-v'),vMax=panel.querySelector('#c411f-smax-v');
            if(!slMin)return;
            const M=CFG.MAX_SIZE_GB;slMin.value=min;slMax.value=max>=M?M:max;
            const pMin=(min/M)*100,pMax=(Math.min(max>=M?M:max,M)/M)*100;
            fill.style.left=pMin+'%';fill.style.width=(pMax-pMin)+'%';
            vMin.textContent=Utils.formatGB(min);vMax.textContent=max>=M?'∞':Utils.formatGB(max);
        }

        function _seasonRangeUI(min, max) {
            const slMin=panel.querySelector('#c411f-srmin'),slMax=panel.querySelector('#c411f-srmax');
            const fill=panel.querySelector('#c411f-srfill'),vMin=panel.querySelector('#c411f-srmin-v'),vMax=panel.querySelector('#c411f-srmax-v');
            if(!slMin)return;
            slMin.value=min;slMax.value=max;
            const pMin=((min-1)/19)*100,pMax=((max-1)/19)*100;
            fill.style.left=pMin+'%';fill.style.width=(pMax-pMin)+'%';
            vMin.textContent=String(min).padStart(2,'0');vMax.textContent=String(max).padStart(2,'0');
        }

        function syncChips() {
            const s=State.get();
            panel.querySelectorAll('.c411f-chip').forEach(c=>c.classList.toggle('--on',s[c.dataset.f]?.has(c.dataset.v)));
        }

        function syncInputs() {
            const s=State.get();
            panel.querySelector('#c411f-text').value=s.text;
            panel.querySelector('#c411f-year').value=s.year;
            _sizeUI(s.sizeMin,s.sizeMax);
            _seasonRangeUI(s.seasonMin||1,s.seasonMax||20);
        }

        function updateCount(vis, tot) {
            const cEl=document.getElementById('c411f-count'),tEl=document.getElementById('c411f-total');
            const sEl=document.getElementById('c411f-stats'),rBtn=document.getElementById('c411f-reset');
            if(cEl)cEl.textContent=vis;if(tEl)tEl.textContent=tot;
            if(sEl)sEl.classList.toggle('--on',!State.empty());
            if(rBtn)rBtn.classList.toggle('--active',!State.empty());
        }

        function refreshPresets() {
            const sel=panel?.querySelector('#c411f-psel');if(!sel)return;
            const cur=sel.value,ps=Store.listPresets();
            sel.innerHTML=`<option value="">— Preset —</option>`+ps.map(p=>`<option value="${p}"${p===cur?' selected':''}>${p}</option>`).join('');
        }

        function bindEvents() {
            // Collapse
            const togBtn=panel.querySelector('#c411f-toggle'),body=panel.querySelector('#c411f-body'),lbl=panel.querySelector('#c411f-tlbl');
            let collapsed=false;
            togBtn.addEventListener('click',()=>{collapsed=!collapsed;body.classList.toggle('--closed',collapsed);togBtn.classList.toggle('--up',collapsed);lbl.textContent=collapsed?'Afficher':'Réduire';});

            // Chips (qualité, langue, type, saison)
            panel.querySelectorAll('.c411f-chip').forEach(c=>{
                c.addEventListener('click',()=>{
                    State.toggle(c.dataset.f,c.dataset.v);
                    c.classList.toggle('--on',State.get()[c.dataset.f].has(c.dataset.v));
                    Engine.apply(true);Store.save();
                });
            });

            // Texte
            panel.querySelector('#c411f-text').addEventListener('input',Utils.debounce(e=>{State.update({text:e.target.value});Engine.apply();Store.save();},CFG.DEBOUNCE_MS));

            // Année
            panel.querySelector('#c411f-year').addEventListener('input',Utils.debounce(e=>{const v=e.target.value.trim();if(!v||/^\d{4}$/.test(v)){State.update({year:v});Engine.apply();Store.save();}},CFG.DEBOUNCE_MS));

            // Slider taille
            const sMin=panel.querySelector('#c411f-smin'),sMax=panel.querySelector('#c411f-smax');
            const doSize=()=>{let mn=parseFloat(sMin.value),mx=parseFloat(sMax.value);if(mn>mx-0.5)sMin.value=mx-0.5;mn=parseFloat(sMin.value);_sizeUI(mn,mx>=CFG.MAX_SIZE_GB?Infinity:mx);State.update({sizeMin:mn,sizeMax:mx>=CFG.MAX_SIZE_GB?Infinity:mx});Engine.apply();Store.save();};
            sMin.addEventListener('input',doSize);sMax.addEventListener('input',doSize);

            // Slider plage de saisons
            const srMin=panel.querySelector('#c411f-srmin'),srMax=panel.querySelector('#c411f-srmax');
            const doSeason=()=>{let mn=parseInt(srMin.value),mx=parseInt(srMax.value);if(mn>mx)srMin.value=mx;mn=parseInt(srMin.value);_seasonRangeUI(mn,mx);State.update({seasonMin:mn,seasonMax:mx});Engine.apply();Store.save();};
            srMin.addEventListener('input',doSeason);srMax.addEventListener('input',doSeason);

            // Reset
            panel.querySelector('#c411f-reset').addEventListener('click',()=>{State.reset();syncChips();syncInputs();Engine.apply(true);Store.save();});

            // Presets
            panel.querySelector('#c411f-psave').addEventListener('click',()=>{const n=prompt('Nom du preset :','');if(!n?.trim())return;Store.savePreset(n.trim());refreshPresets();});
            const pSel=panel.querySelector('#c411f-psel'),pDel=panel.querySelector('#c411f-pdel');
            pSel.addEventListener('change',()=>{pDel.style.display=pSel.value?'':'none';if(pSel.value){Store.loadPreset(pSel.value);syncChips();syncInputs();Engine.apply(true);}});
            pDel.addEventListener('click',()=>{Store.delPreset(pSel.value);refreshPresets();pDel.style.display='none';pSel.value='';});

            Engine.onCount(updateCount);
        }

        function inject(resultsBlock) {
            injectCSS();panel=buildPanel();
            resultsBlock.parentNode.insertBefore(panel,resultsBlock);
            bindEvents();refreshPresets();
        }

        return {
            inject,syncChips,syncInputs,
            focus:()=>panel?.querySelector('#c411f-text')?.focus(),
            reset:()=>{State.reset();syncChips();syncInputs();Engine.apply(true);Store.save();},
        };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑰ HOVER MANAGER TMDB  — passe le contexte torrent au popup
    // ═══════════════════════════════════════════════════════════════════════════
    const HoverManager = (() => {
        let hoverT=null,hideT=null,currLink=null,fetchId=0,mx=0,my=0;
        const attached=new WeakSet();
        const onMove=Utils.debounce(e=>{mx=e.clientX;my=e.clientY;if(PopupUI.isShown())PopupUI.move(mx,my);},14);

        async function onEnter(link, rowCtx) {
            clearTimeout(hideT);if(currLink===link)return;currLink=link;
            const rawTitle=DOM.getTorrentTitle(link);if(!rawTitle)return;
            clearTimeout(hoverT);
            hoverT=setTimeout(async()=>{
                const{title,isSeries,year}=TitleParser.parse(rawTitle);
                log.i('Hover:',rawTitle,'→',title);
                link.classList.add('tmdb-link-active');

                // ── Transmettre le contexte torrent au popup ─────────────────────
                PopupUI.setContext({
                    hash     : rowCtx?.hash || null,
                    title    : rawTitle,
                    dlBtn    : rowCtx?.dlBtn || null,
                    linkHref : link.href,
                });

                PopupUI.setLoading();
                PopupUI.show(mx,my);

                const myId=++fetchId;
                const data=await TMDB.search(rawTitle,isSeries,year);
                if(myId!==fetchId||currLink!==link)return;

                if(data){
                    PopupUI.setData(data);
                    // Précharger les voisins
                    const all=DOM.getTorrentLinks(),idx=all.indexOf(link);
                    for(let i=Math.max(0,idx-CFG.PRELOAD_RADIUS);i<=Math.min(all.length-1,idx+CFG.PRELOAD_RADIUS);i++){
                        if(all[i]===link)continue;
                        const rt=DOM.getTorrentTitle(all[i]),p=TitleParser.parse(rt);
                        if(!Cache.has(`${p.title}|${p.isSeries}|${p.year}`))
                            setTimeout(()=>TMDB.search(rt,p.isSeries,p.year),300*Math.abs(i-idx));
                    }
                } else { PopupUI.setError(title); }
            },CFG.HOVER_DELAY_MS);
        }

        function onLeave(link) {
            clearTimeout(hoverT);link?.classList.remove('tmdb-link-active');
            hideT=setTimeout(()=>{if(currLink===link){currLink=null;PopupUI.hide();fetchId++;}},CFG.HIDE_DELAY_MS);
        }

        function attachLink(link) {
            if(attached.has(link))return;attached.add(link);
            // Récupérer le contexte de la ligne parente
            let row=link.parentElement;
            while(row&&!row.classList.contains('transition-colors'))row=row.parentElement;
            const rowData = row ? Scanner.get(row) : null;

            link.addEventListener('mouseenter',()=>onEnter(link,rowData));
            link.addEventListener('mouseleave',()=>onLeave(link));
            link.addEventListener('click',()=>{PopupUI.hide();currLink=null;fetchId++;});
        }

        function scan(root=document) {
            DOM.getTorrentLinks(root).forEach(link=>attachLink(link));
        }

        function init() {
            document.addEventListener('mousemove',onMove,{passive:true});
            document.addEventListener('click',e=>{if(!e.target.closest('#tmdb-pro-popup')){PopupUI.hide();currLink=null;fetchId++;}});
            document.addEventListener('keydown',e=>{if(e.key==='Escape'){PopupUI.hide();currLink=null;fetchId++;}});
            scan();
        }

        return {init,scan};
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑱ RACCOURCIS CLAVIER
    // ═══════════════════════════════════════════════════════════════════════════
    function initKeyboard() {
        document.addEventListener('keydown',e=>{
            const tag=e.target.tagName,inSite=(tag==='INPUT'||tag==='TEXTAREA')&&!e.target.closest('#c411f-panel');
            if(inSite)return;
            if(e.altKey&&e.key==='f'){e.preventDefault();FilterUI.focus();}
            if(e.altKey&&e.key==='r'){e.preventDefault();FilterUI.reset();}
            if(e.key==='Escape'&&State.get().text){State.update({text:''});FilterUI.syncInputs();Engine.apply(true);}
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑲ OBSERVER UNIFIÉ
    // ═══════════════════════════════════════════════════════════════════════════
    function initObserver() {
        const processNew=Utils.debounce(newRows=>{Engine.addRows(newRows);newRows.forEach(r=>Deco.decorate(r));Engine.apply(true);},300);
        new MutationObserver(muts=>{
            const newRows=[];
            for(const m of muts){
                for(const node of m.addedNodes){
                    if(node.nodeType!==1||node.id==='c411f-panel'||node.id==='tmdb-pro-popup')continue;
                    HoverManager.scan(node);
                    node.querySelectorAll?.('posterhoverpopover').forEach(pp=>{
                        let el=pp.parentElement;
                        while(el){if(el.classList.contains('transition-colors')){newRows.push(el);break;}el=el.parentElement;}
                    });
                }
            }
            if(newRows.length)processNew([...new Set(newRows)]);
        }).observe(document.body,{childList:true,subtree:true});
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ㉀ BADGE PLUS — indicateur premium flottant
    //     • Positionné intelligemment sous la navbar C411 (ne couvre pas le logo)
    //     • Suit les bords au resize de la fenêtre
    //     • Draggable, position sauvegardée en localStorage
    //     • Au survol : carte de statut complète avec compteur live
    // ═══════════════════════════════════════════════════════════════════════════
    const Badge = (() => {
        const POS_KEY = 'c411_badge_pos_v2';
        const MARGIN  = 10; // marge bords écran

        // ── Détecter la hauteur de la navbar fixe de C411 ──────────────────
        function _navHeight() {
            // C411 utilise une nav fixe en haut — on cherche l'élément le plus haut
            const candidates = [
                'nav[class]', 'header[class]',
                '[class*="navbar"]', '[class*="header"]',
                'nav', 'header',
            ];
            for (const sel of candidates) {
                try {
                    const el = document.querySelector(sel);
                    if (!el) continue;
                    const r = el.getBoundingClientRect();
                    // Vérifier que c'est bien un élément en haut (fixe ou sticky)
                    if (r.top >= 0 && r.top < 30 && r.height > 20 && r.height < 150) {
                        return Math.round(r.bottom);
                    }
                } catch {}
            }
            return 64; // fallback : C411 navbar ≈ 60px
        }

        // ── Position initiale : collé au bord droit, sous la navbar ─────────
        function _defaultPos(wrap) {
            const navH = _navHeight();
            const ww   = window.innerWidth;
            const bw   = wrap.offsetWidth || 130;
            return {
                x: ww - bw - MARGIN,
                y: navH + MARGIN,
            };
        }

        // ── Charger/sauvegarder la position ─────────────────────────────────
        function _loadPos()  { try { return JSON.parse(localStorage.getItem(POS_KEY)); } catch { return null; } }
        function _savePos(x, y) { try { localStorage.setItem(POS_KEY, JSON.stringify({ x, y })); } catch {} }

        // ── Clamp : garder dans le viewport (sous la navbar) ────────────────
        function _clamp(wrap, x, y) {
            const navH = _navHeight();
            const bw   = wrap.offsetWidth  || 130;
            const bh   = wrap.offsetHeight || 32;
            const safeX = Math.max(MARGIN, Math.min(x, window.innerWidth  - bw - MARGIN));
            const safeY = Math.max(navH + MARGIN, Math.min(y, window.innerHeight - bh - MARGIN));
            return { x: safeX, y: safeY };
        }

        // ── Appliquer une position ───────────────────────────────────────────
        function _setPos(wrap, x, y) {
            wrap.style.left = x + 'px';
            wrap.style.top  = y + 'px';
        }

        function _injectCSS() {
            if (document.getElementById('c411-badge-css')) return;
            const s = document.createElement('style'); s.id = 'c411-badge-css';
            s.textContent = `
                /* ── Wrapper ──────────────────────────────────────────────── */
                #c411-badge-wrap {
                    position: fixed;
                    z-index: 2147483646;
                    cursor: grab;
                    user-select: none;
                    touch-action: none;
                    font-family: 'Segoe UI', system-ui, sans-serif;
                    /* position définie par JS — pas de left/top ici */
                }
                #c411-badge-wrap.--placed {
                    animation: c411b-appear 420ms cubic-bezier(.16,1,.3,1) both;
                }
                @keyframes c411b-appear {
                    from { opacity:0; transform:scale(.85) translateY(-8px); }
                    to   { opacity:1; transform:scale(1) translateY(0); }
                }
                #c411-badge-wrap:active { cursor: grabbing; }

                /* ── Pill ─────────────────────────────────────────────────── */
                #c411-badge-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    padding: 5px 12px 5px 8px;
                    border-radius: 20px;
                    background: linear-gradient(135deg, #7f1d1d 0%, #dc2626 55%, #b91c1c 100%);
                    border: 1px solid rgba(255,120,120,.3);
                    box-shadow:
                        0 0 0 1px rgba(255,255,255,.07),
                        0 4px 18px rgba(220,38,38,.5),
                        0 2px 6px rgba(0,0,0,.55);
                    position: relative;
                    overflow: hidden;
                    white-space: nowrap;
                }
                /* Reflet haut */
                #c411-badge-pill::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 48%;
                    background: linear-gradient(to bottom, rgba(255,255,255,.2), transparent);
                    border-radius: 20px 20px 0 0;
                    pointer-events: none;
                }

                /* ── Étoile animée ────────────────────────────────────────── */
                #c411-badge-icon {
                    font-size: 13px;
                    line-height: 1;
                    flex-shrink: 0;
                    filter: drop-shadow(0 0 5px rgba(255,210,0,.8));
                    display: inline-block;
                    animation: c411b-star 7s ease-in-out infinite;
                }
                @keyframes c411b-star {
                    0%,100% { transform: rotate(0deg) scale(1); }
                    20%     { transform: rotate(72deg) scale(1.2); }
                    40%     { transform: rotate(144deg) scale(1); }
                    60%     { transform: rotate(216deg) scale(1.15); }
                    80%     { transform: rotate(288deg) scale(1); }
                }

                /* ── Texte PLUS ───────────────────────────────────────────── */
                #c411-badge-text {
                    font-size: 11px;
                    font-weight: 800;
                    letter-spacing: .16em;
                    text-transform: uppercase;
                    color: #fff;
                    text-shadow: 0 1px 4px rgba(0,0,0,.5);
                    line-height: 1;
                }

                /* ── Point vert pulsant ───────────────────────────────────── */
                #c411-badge-dot {
                    width: 6px; height: 6px;
                    border-radius: 50%;
                    background: #4ade80;
                    flex-shrink: 0;
                    animation: c411b-pulse 2.2s ease-in-out infinite;
                }
                @keyframes c411b-pulse {
                    0%,100% { box-shadow: 0 0 0 0 rgba(74,222,128,.5); }
                    50%     { box-shadow: 0 0 0 5px rgba(74,222,128,.0); }
                }

                /* ── Carte dépliable ──────────────────────────────────────── */
                #c411-badge-card {
                    position: absolute;
                    width: 228px;
                    background: rgba(6, 12, 7, 0.98);
                    border: 1px solid rgba(220,38,38,.25);
                    border-radius: 11px;
                    overflow: hidden;
                    box-shadow: 0 16px 40px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.04) inset;
                    backdrop-filter: blur(20px);
                    opacity: 0;
                    transform: scale(.95);
                    transition: opacity 170ms ease, transform 170ms cubic-bezier(.16,1,.3,1);
                    pointer-events: none;
                }
                /* Ligne rouge déco en haut */
                #c411-badge-card::before {
                    content: '';
                    display: block;
                    height: 2px;
                    background: linear-gradient(90deg, transparent, #dc2626 30%, #f87171 70%, transparent);
                }
                #c411-badge-wrap:hover #c411-badge-card {
                    opacity: 1;
                    transform: scale(1);
                    pointer-events: all;
                }

                /* Positionnement dynamique de la carte (géré par JS) */
                #c411-badge-card.--below { top: calc(100% + 7px); }
                #c411-badge-card.--above { bottom: calc(100% + 7px); }
                #c411-badge-card.--left  { left: 0; }
                #c411-badge-card.--right { right: 0; }

                /* ── Contenu de la carte ──────────────────────────────────── */
                .c411b-head {
                    padding: 10px 13px 8px;
                    border-bottom: 1px solid rgba(255,255,255,.05);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .c411b-head-title { font-size: 11.5px; font-weight: 700; color: #fff; letter-spacing:.04em; }
                .c411b-head-ver   { font-size: 9px; color: rgba(255,255,255,.25); font-family: monospace; padding: 1px 5px; background: rgba(220,38,38,.15); border: 1px solid rgba(220,38,38,.2); border-radius: 4px; }

                .c411b-rows {
                    padding: 9px 13px 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 7px;
                }
                .c411b-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                .c411b-lbl {
                    display: flex;
                    align-items: center;
                    gap: 7px;
                    font-size: 11px;
                    color: rgba(255,255,255,.5);
                }
                .c411b-lbl-icon { font-size: 13px; line-height:1; }
                .c411b-chip {
                    font-size: 9px;
                    font-weight: 700;
                    letter-spacing: .05em;
                    padding: 2px 8px;
                    border-radius: 20px;
                    white-space: nowrap;
                }
                .c411b-chip.--on   { background: rgba(74,222,128,.12);  border: 1px solid rgba(74,222,128,.35); color: #4ade80; }
                .c411b-chip.--off  { background: rgba(239,68,68,.1);    border: 1px solid rgba(239,68,68,.3);   color: #f87171; }
                .c411b-chip.--warn { background: rgba(251,146,60,.1);   border: 1px solid rgba(251,146,60,.3);  color: #fb923c; }

                .c411b-sep { height: 1px; background: rgba(255,255,255,.05); margin: 2px 0; }

                .c411b-foot {
                    padding: 7px 13px 9px;
                    border-top: 1px solid rgba(255,255,255,.05);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    font-size: 10px;
                    color: rgba(255,255,255,.2);
                }
                #c411b-counter {
                    font-size: 10px;
                    font-weight: 700;
                    color: rgba(52,211,153,.7);
                }
                #c411b-counter span { color: rgba(255,255,255,.25); font-weight: 400; }

                /* ── Indicateur de déplacement ──────────────────────────────── */
                #c411-badge-pill:hover {
                    filter: brightness(1.1);
                    box-shadow:
                        0 0 0 1px rgba(255,255,255,.12),
                        0 6px 24px rgba(220,38,38,.6),
                        0 2px 6px rgba(0,0,0,.55);
                }
            `;
            document.head.appendChild(s);
        }

        function _build() {
            const hasAD   = CFG.ALLDEBRID_KEY && CFG.ALLDEBRID_KEY !== 'VOTRE_CLE_ALLDEBRID_ICI';
            const hasTMDB = CFG.TMDB_API_KEY  && CFG.TMDB_API_KEY.length > 10;

            const wrap = document.createElement('div');
            wrap.id = 'c411-badge-wrap';

            wrap.innerHTML = `
                <div id="c411-badge-pill">
                    <span id="c411-badge-icon">✦</span>
                    <span id="c411-badge-text">C411&nbsp;PLUS</span>
                    <div id="c411-badge-dot"></div>
                </div>
                <div id="c411-badge-card">
                    <div class="c411b-head">
                        <span class="c411b-head-title">C411 Suite Ultra Pro</span>
                        <span class="c411b-head-ver">v5.4</span>
                    </div>
                    <div class="c411b-rows">
                        <div class="c411b-row">
                            <span class="c411b-lbl"><span class="c411b-lbl-icon">🎬</span>Popup TMDB</span>
                            <span class="c411b-chip ${hasTMDB ? '--on' : '--off'}">${hasTMDB ? '✓ Actif' : '✗ Clé absente'}</span>
                        </div>
                        <div class="c411b-row">
                            <span class="c411b-lbl"><span class="c411b-lbl-icon">🔍</span>Filtres avancés</span>
                            <span class="c411b-chip --on">✓ Actif</span>
                        </div>
                        <div class="c411b-row">
                            <span class="c411b-lbl"><span class="c411b-lbl-icon">📺</span>Tags & Saisons</span>
                            <span class="c411b-chip --on">✓ Actif</span>
                        </div>
                        <div class="c411b-row">
                            <span class="c411b-lbl"><span class="c411b-lbl-icon">⬇</span>Boutons DL/Hash</span>
                            <span class="c411b-chip --on">✓ Actif</span>
                        </div>
                        <div class="c411b-sep"></div>
                        <div class="c411b-row">
                            <span class="c411b-lbl"><span class="c411b-lbl-icon">🟠</span>AllDebrid</span>
                            <span class="c411b-chip ${hasAD ? '--on' : '--warn'}">${hasAD ? '✓ Configuré' : '⚠ Clé absente'}</span>
                        </div>
                    </div>
                    <div class="c411b-foot">
                        <span>by Hefied</span>
                        <span id="c411b-counter">— <span>/ — torrents</span></span>
                    </div>
                </div>`;

            // Compteur live
            Engine.onCount((vis, tot) => {
                const el = document.getElementById('c411b-counter');
                if (el) el.innerHTML = `${vis} <span>/ ${tot} torrents</span>`;
            });

            return wrap;
        }

        // ── Positionner la carte (above/below, left/right) selon l'espace dispo ──
        function _positionCard(wrap) {
            const card = wrap.querySelector('#c411-badge-card');
            if (!card) return;
            const rect = wrap.getBoundingClientRect();
            const cardH = 220, cardW = 228;

            // Vertical : en dessous si assez de place, sinon au-dessus
            card.classList.toggle('--below', rect.bottom + cardH + 10 <= window.innerHeight);
            card.classList.toggle('--above', rect.bottom + cardH + 10 >  window.innerHeight);
            // Horizontal : aligné à gauche si assez de place à droite, sinon à droite (collé au bord)
            card.classList.toggle('--left',  rect.left + cardW <= window.innerWidth);
            card.classList.toggle('--right', rect.left + cardW >  window.innerWidth);
        }

        // ── Drag & Drop avec clamp au resize ─────────────────────────────────
        function _makeDraggable(wrap) {
            let dragging = false, ox = 0, oy = 0;

            wrap.addEventListener('mousedown', e => {
                if (e.target.closest('#c411-badge-card')) return; // carte interactive
                dragging = true;
                const rect = wrap.getBoundingClientRect();
                ox = e.clientX - rect.left;
                oy = e.clientY - rect.top;
                wrap.style.transition = 'none';
                wrap.style.animation  = 'none';
                wrap.classList.remove('--placed');
                e.preventDefault();
            });

            document.addEventListener('mousemove', e => {
                if (!dragging) return;
                const { x, y } = _clamp(wrap, e.clientX - ox, e.clientY - oy);
                _setPos(wrap, x, y);
                _savePos(x, y);
                _positionCard(wrap);
            });

            document.addEventListener('mouseup', () => { dragging = false; });

            // ── Resize : recadrer le badge s'il déborde ────────────────────────
            window.addEventListener('resize', Utils.debounce(() => {
                const rect = wrap.getBoundingClientRect();
                const { x, y } = _clamp(wrap, rect.left, rect.top);
                _setPos(wrap, x, y);
                _savePos(x, y);
                _positionCard(wrap);
            }, 120));

            // Repositionner la carte au survol aussi
            wrap.addEventListener('mouseenter', () => _positionCard(wrap));
        }

        function init() {
            _injectCSS();
            const wrap = _build();
            document.body.appendChild(wrap);

            // Positionner après insertion (pour avoir offsetWidth/Height)
            requestAnimationFrame(() => {
                const saved = _loadPos();
                let x, y;
                if (saved && typeof saved.x === 'number') {
                    // Valider la position sauvegardée (peut être hors écran après resize)
                    const clamped = _clamp(wrap, saved.x, saved.y);
                    x = clamped.x; y = clamped.y;
                } else {
                    const def = _defaultPos(wrap);
                    x = def.x; y = def.y;
                }
                _setPos(wrap, x, y);
                _positionCard(wrap);
                // Déclencher l'animation d'apparition
                wrap.classList.add('--placed');
            });

            _makeDraggable(wrap);
        }

        return { init };
    })();

    // ═══════════════════════════════════════════════════════════════════════════
    //  ⑳ POINT D'ENTRÉE
    // ═══════════════════════════════════════════════════════════════════════════
    let retries=0;

    function init() {
        const resultsBlock=DOM.findResultsBlock();
        if(!resultsBlock){
            retries++;
            if(retries<=CFG.RETRY_MAX){log.i(`Retry ${retries}/${CFG.RETRY_MAX}…`);setTimeout(init,CFG.RETRY_DELAY);}
            else log.e('Bloc résultats introuvable');
            return;
        }
        const rows=DOM.findRows(resultsBlock);
        log.i(`${rows.length} lignes trouvées`);
        if(!rows.length&&retries<CFG.RETRY_MAX){retries++;setTimeout(init,CFG.RETRY_DELAY);return;}

        rows.forEach(r=>Deco.decorate(r));
        Engine.setRows(rows);
        if(!document.getElementById('c411f-panel'))FilterUI.inject(resultsBlock);
        Store.load();FilterUI.syncChips();FilterUI.syncInputs();Engine.apply(true);

        HoverManager.init();
        initObserver();
        initKeyboard();

        // ── Badge PLUS ──────────────────────────────────────────────────────────
        if (!document.getElementById('c411-badge-wrap')) Badge.init();

        log.i('C411 Suite v5.4 ✓ — Hefied');
    }

    if(document.readyState==='loading'){
        document.addEventListener('DOMContentLoaded',()=>setTimeout(init,CFG.INIT_DELAY_MS));
    } else {
        setTimeout(init,CFG.INIT_DELAY_MS);
    }

})();
