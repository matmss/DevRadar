import React, {useState, useEffect} from 'react';

import './styles.css';

// Registers the signed-in developer: the GitHub username comes from the session token, so the
// form only asks for techs and location.
function DevForm({onSubmit}) {
  const [techs, setTechs] = useState('');

  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');


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

    try {
      await onSubmit({
        techs,
        latitude,
        longitude,
      });
    } catch {
      // The parent already shows the error; keep the fields so the user can correct them.
      return;
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

      <button type="submit">Salvar</button>
    </form>

  );
}

export default DevForm;
