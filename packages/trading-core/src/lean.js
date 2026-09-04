"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PYTH_IDS = void 0;
exports.getCurrentOrNext15mMarket = getCurrentOrNext15mMarket;
exports.getMarketQuote = getMarketQuote;
exports.getKalshiEventLiveSpot = getKalshiEventLiveSpot;
exports.getPythSpot = getPythSpot;
exports.resolveStrike = resolveStrike;
exports.decideLean = decideLean;
exports.computeLean = computeLean;
const client_1 = require("./client");
const PUBLIC_BASE = 'https://api.elections.kalshi.com/trade-api/v2';
exports.PYTH_IDS = {
    WTI: '925ca92ff005ae943c158e3563f59698ce7e75c5a8c8dd43303a0a154887b3e6',
    Gold: '765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
    Silver: 'f2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e',
    BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
};
const LEAN_FETCH_TIMEOUT_MS = 12_000;
const EVENTS_CACHE_TTL_MS = 20_000;
const QUOTE_CACHE_TTL_MS = 5_000;
const eventsCache = new Map();
const quoteCache = new Map();
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function jsonGet(url, fetchImpl = fetch, attempt = 0) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl != null
        ? setTimeout(() => {
            try {
                ctrl.abort();
            }
            catch {
                /* */
            }
        }, LEAN_FETCH_TIMEOUT_MS)
        : null;
    try {
        const res = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
        if (res.status === 429) {
            if (attempt >= 2)
                throw new Error('http_429');
            const waitMs = 2500 * (attempt + 1);
            await sleep(waitMs);
            return jsonGet(url, fetchImpl, attempt + 1);
        }
        if (!res.ok)
            throw new Error(`http_${res.status}`);
        return await res.json();
    }
    catch (e) {
        if (e?.name === 'AbortError')
            throw new Error('lean_fetch_timeout');
        throw e;
    }
    finally {
        if (timer != null)
            clearTimeout(timer);
    }
}
function parseStrikeFromText(text) {
    if (!text)
        return null;
    if (/TBD/i.test(text))
        return null;
    const m = text.match(/(?:target\s*price|floor|strike)\s*[:=]?\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
    if (!m)
        return null;
    const n = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}
async function getCurrentOrNext15mMarket(seriesTicker, fetchImpl = fetch, now = new Date()) {
    const url = `${PUBLIC_BASE}/events?limit=8&status=open&series_ticker=${encodeURIComponent(seriesTicker)}&with_nested_markets=true`;
    const cached = eventsCache.get(seriesTicker);
    let ev;
    if (cached && Date.now() - cached.at < EVENTS_CACHE_TTL_MS) {
        ev = cached.value;
    }
    else {
        ev = await jsonGet(url, fetchImpl);
        eventsCache.set(seriesTicker, { at: Date.now(), value: ev });
    }
    const candidates = [];
    for (const e of ev.events || []) {
        let markets = e.markets || [];
        if ((!markets || markets.length === 0) && ev.markets) {
            markets = ev.markets.filter((m) => m.event_ticker === e.event_ticker);
        }
        for (const m of markets || []) {
            if (!m?.ticker)
                continue;
            candidates.push({
                event_ticker: String(e.event_ticker),
                market_ticker: String(m.ticker),
                open_utc: m.open_time ? new Date(m.open_time) : null,
                close_utc: m.close_time ? new Date(m.close_time) : null,
                floor_strike: m.floor_strike != null ? Number(m.floor_strike) : null,
                yes_sub_title: m.yes_sub_title,
                no_sub_title: m.no_sub_title,
            });
        }
    }
    if (candidates.length === 0)
        return null;
    const live = candidates
        .filter((c) => c.open_utc &&
        c.close_utc &&
        now >= c.open_utc &&
        now < c.close_utc)
        .sort((a, b) => (a.close_utc.getTime() - b.close_utc.getTime()));
    if (live.length)
        return { phase: 'live', row: live[0] };
    const upcoming = candidates
        .filter((c) => c.open_utc && now < c.open_utc)
        .sort((a, b) => a.open_utc.getTime() - b.open_utc.getTime());
    if (upcoming.length)
        return { phase: 'upcoming', row: upcoming[0] };
    const recent = candidates
        .filter((c) => c.close_utc)
        .sort((a, b) => b.close_utc.getTime() - a.close_utc.getTime());
    if (recent.length)
        return { phase: 'ended', row: recent[0] };
    return { phase: 'unknown', row: candidates[0] };
}
async function getMarketQuote(ticker, fetchImpl = fetch) {
    const cached = quoteCache.get(ticker);
    if (cached && Date.now() - cached.at < QUOTE_CACHE_TTL_MS) {
        return cached.value;
    }
    const resp = await jsonGet(`${PUBLIC_BASE}/markets/${encodeURIComponent(ticker)}`, fetchImpl);
    const market = resp.market;
    quoteCache.set(ticker, { at: Date.now(), value: market });
    return market;
}
async function getKalshiEventLiveSpot(eventTicker, fetchImpl = fetch) {
    try {
        const resp = await jsonGet(`${PUBLIC_BASE}/live_data/events/${encodeURIComponent(eventTicker)}?range=15min`, fetchImpl);
        const series = resp?.live_data?.details?.timeseries;
        if (!Array.isArray(series) || series.length < 1)
            return null;
        const last = series[series.length - 1];
        if (last?.v == null)
            return null;
        return { price: Number(last.v), timeseries: series };
    }
    catch {
        return null;
    }
}
async function getPythSpot(feedId, fetchImpl = fetch) {
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=${feedId}&parsed=true`;
    const resp = await jsonGet(url, fetchImpl);
    const p = resp?.parsed?.[0]?.price;
    if (!p)
        throw new Error('no_pyth');
    return Number(p.price) * Math.pow(10, Number(p.expo));
}
function resolveStrike(row, quote, liveSpot) {
    for (const c of [row, quote]) {
        if (!c)
            continue;
        if (c.floor_strike != null && String(c.floor_strike).trim() !== '') {
            const n = Number(c.floor_strike);
            if (Number.isFinite(n))
                return n;
        }
        const fromYes = parseStrikeFromText(c.yes_sub_title);
        if (fromYes != null)
            return fromYes;
        const fromNo = parseStrikeFromText(c.no_sub_title);
        if (fromNo != null)
            return fromNo;
    }
    if (liveSpot?.timeseries && row.open_utc) {
        const openMs = row.open_utc.getTime();
        let best = null;
        let bestAbs = Infinity;
        for (const p of liveSpot.timeseries) {
            if (p?.t == null || p?.v == null)
                continue;
            const d = Math.abs(Number(p.t) - openMs);
            if (d < bestAbs) {
                bestAbs = d;
                best = p;
            }
        }
        if (best && bestAbs <= 5000)
            return Number(best.v);
    }
    return null;
}
function decideLean(phase, live, strike, cushion) {
    const abs_gap = Math.abs(live - strike);
    if (phase === 'ended' || phase === 'upcoming') {
        return { decision: 'SKIP', abs_gap };
    }
    if (abs_gap < cushion)
        return { decision: 'SKIP', abs_gap };
    return { decision: live >= strike ? 'YES' : 'NO', abs_gap };
}
async function computeLean(asset, cushion, fetchImpl = fetch, now = new Date()) {
    const series = client_1.SERIES_BY_ASSET[asset];
    const pick = await getCurrentOrNext15mMarket(series, fetchImpl, now);
    if (!pick) {
        return { ok: false, asset, decision: 'SKIP', phase: 'unknown', message: 'no_market' };
    }
    const quote = await getMarketQuote(pick.row.market_ticker, fetchImpl);
    let liveSpot = await getKalshiEventLiveSpot(pick.row.event_ticker, fetchImpl);
    let priceSource = 'predict_chart';
    let live;
    if (liveSpot) {
        live = liveSpot.price;
    }
    else {
        live = await getPythSpot(exports.PYTH_IDS[asset], fetchImpl);
        priceSource = 'pyth_fallback';
        liveSpot = null;
    }
    const strike = resolveStrike(pick.row, quote, liveSpot);
    if (strike == null) {
        return {
            ok: false,
            asset,
            decision: 'SKIP',
            phase: pick.phase,
            market_ticker: pick.row.market_ticker,
            message: 'strike_tbd',
        };
    }
    const { decision, abs_gap } = decideLean(pick.phase, live, strike, cushion);
    const close = pick.row.close_utc;
    const open = pick.row.open_utc;
    const minutes_left = close == null ? undefined : Math.max(0, Math.floor((close.getTime() - now.getTime()) / 60000));
    const minutes_elapsed = open == null ? undefined : Math.max(0, Math.floor((now.getTime() - open.getTime()) / 60000));
    let yes_bid = null;
    let yes_ask = null;
    let no_ask = null;
    try {
        if (quote?.yes_bid_dollars != null)
            yes_bid = Number(quote.yes_bid_dollars);
    }
    catch {
        /* */
    }
    try {
        if (quote?.yes_ask_dollars != null)
            yes_ask = Number(quote.yes_ask_dollars);
    }
    catch {
        /* */
    }
    try {
        if (quote?.no_ask_dollars != null)
            no_ask = Number(quote.no_ask_dollars);
    }
    catch {
        /* */
    }
    return {
        ok: true,
        asset,
        phase: pick.phase,
        market_ticker: pick.row.market_ticker,
        event_ticker: pick.row.event_ticker,
        live,
        strike,
        abs_gap,
        minutes_left,
        minutes_elapsed,
        decision,
        yes_bid,
        yes_ask,
        no_ask,
        price_source: priceSource,
        cushion,
    };
}
