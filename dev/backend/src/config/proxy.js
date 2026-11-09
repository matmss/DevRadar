// Express `trust proxy` from TRUST_PROXY. It decides whether req.ip (and so the rate-limit
// key) comes from X-Forwarded-For. Default off: the socket address is used, and a client
// cannot pick its own rate-limit bucket by sending X-Forwarded-For.
//
//   unset, "", "false"     -> false (default)
//   "true"                 -> true (trust every hop: only behind a proxy that overwrites XFF)
//   "1", "2", ...          -> trust that many hops from the server (preferred)
//   "loopback,10.0.0.0/8"  -> trust these addresses/subnets (Express names allowed)
const HOP_COUNT_PATTERN = /^\d+$/;

/**
 * @param {string | undefined} [raw] - defaults to process.env.TRUST_PROXY
 * @returns {boolean | number | string[]} a value for app.set('trust proxy', ...)
 */
function trustProxySetting(raw = process.env.TRUST_PROXY) {
  const value = (raw || '').trim();
  if (value === '' || value.toLowerCase() === 'false') return false;
  if (value.toLowerCase() === 'true') return true;
  if (HOP_COUNT_PATTERN.test(value)) return Number(value);
  return value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
}

module.exports = { trustProxySetting };
