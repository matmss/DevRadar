import React, {useState, useEffect, useRef} from 'react';

import './styles.css';

// Registers the signed-in developer: the GitHub username comes from the session token, so the
// form only asks for techs and location.
function DevForm({onSubmit}) {
  const [techs, setTechs] = useState('');

  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  // One registration at a time (QA-AUTH2-1): "Salvar" is disabled while a request is in flight,
  // and the ref also stops a second submit that arrives before the re-render.
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);


  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        setLatitude(latitude);
        setLongitude(longitude);
      },
      (err) => {
        console.log(err);
      }
    )
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({
        techs,
        latitude,
        longitude,
      });
    } catch {
      // The parent already shows the error; keep the fields so the user can correct them.
      return;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }

    setTechs('');
  }

  return(
    <form onSubmit={handleSubmit}>
      <div className="input-block">
        <label htmlFor="techs">Tecnologias</label>
        <input name="techs" id="techs" required value={techs} onChange={e => setTechs(e.target.value)} />
      </div>

      <div className="input-group">
        <div className="input-block">
          <label htmlFor="latitude">Latitude</label>
          <input name="latitude" id="latitude" required value={latitude} onChange={e => setLatitude(e.target.value)} />
        </div>

        <div className="input-block">
          <label htmlFor="longitude">Longitude</label>
          <input name="longitude" id="longitude" required value={longitude} onChange={e => setLongitude(e.target.value)} />
        </div>
      </div>

      <button type="submit" disabled={submitting}>Salvar</button>
    </form>

  );
}

export default DevForm;
