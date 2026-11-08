const Dev = require('../models/Dev');
const parseStringAsArray = require('../utils/parseStringAsArray');
const { NEARBY_RADIUS_METERS } = require('../utils/nearby');

module.exports = {
    async index(req, res) {
        const { latitude, longitude, techs } = req.query;

        const techsArray = parseStringAsArray(techs);

        const devs = await Dev.find({
            techs: {
                $in: techsArray,
            },
            location: {
                $near: {
                    $geometry: {
                        type: 'Point',
                        coordinates: [Number(longitude), Number(latitude)],
                    },
                    $maxDistance: NEARBY_RADIUS_METERS,
                },
            },
        });

        return res.json({ devs });
    },

    // async update() {

    // },

    // async destroy() {

    // },
};