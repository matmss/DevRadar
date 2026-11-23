const Dev = require('../models/Dev');
const { hydrateStored } = require('../models/utils/hydrateStored');
const parseStringAsArray = require('../utils/parseStringAsArray');
const { NEARBY_RADIUS_METERS } = require('../utils/nearby');

// Read-only geo search. Updating and deleting a profile are PUT/DELETE /devs/me in
// DevController (BUG-008); the old commented-out update/destroy stubs that lived here are gone.
module.exports = {
    async index(req, res) {
        const { latitude, longitude, techs } = req.query;

        const techsArray = typeof techs === 'string' ? parseStringAsArray(techs) : [];
        const lat = Number(latitude);
        const lng = Number(longitude);

        const errors = [];
        if (typeof latitude !== 'string' || latitude.trim() === '' || !Number.isFinite(lat) || Math.abs(lat) > 90) {
            errors.push('latitude must be a number between -90 and 90');
        }
        if (typeof longitude !== 'string' || longitude.trim() === '' || !Number.isFinite(lng) || Math.abs(lng) > 180) {
            errors.push('longitude must be a number between -180 and 180');
        }
        if (techsArray.length === 0) {
            errors.push('techs is required (comma-separated string)');
        }
        if (errors.length > 0) {
            return res.status(400).json({ error: 'Invalid request', details: errors });
        }

        // Lean, then hydrated with the stored _id (QA-PB-4): a hand-edited non-ObjectId _id is
        // answered as stored; a normal dev exactly as before. $near keeps its distance order.
        const stored = await Dev.find({
            techs: {
                $in: techsArray,
            },
            location: {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [lng, lat],
                    },
                    $maxDistance: NEARBY_RADIUS_METERS,
                },
            },
        }, null, { lean: true });

        return res.json({ devs: stored.map((doc) => hydrateStored(Dev, doc)) });
    },
};
