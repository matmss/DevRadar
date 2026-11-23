// Mongoose drops a stored _id it cannot cast to the schema's ObjectId when it reads a document
// (a hand-edited string _id reads as undefined, a 24-hex string comes back as an ObjectId). Every
// read that answers clients or decides ownership hydrates the stored document itself and puts the
// stored _id back, so GET /devs, GET /search, /devs/me and the live events all name the real
// document (QA-PB-1, QA-PB-4). For a normal dev (ObjectId _id) the result is exactly what a
// Mongoose query returns.

/**
 * @param {import('mongoose').Model} Model
 * @param {object} stored - a document as the driver (or a lean query) returned it
 * @returns {import('mongoose').Document} the hydrated document, with the stored _id
 */
function hydrateStored(Model, stored) {
  const doc = Model.hydrate(stored);
  // Bypasses casting on purpose: the value is what MongoDB holds.
  doc._doc._id = stored._id;
  return doc;
}

module.exports = { hydrateStored };
