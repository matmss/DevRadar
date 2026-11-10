import React, { useState, useEffect, useRef } from 'react';

import './styles.css';

/**
 * The form's initial values: the saved profile's techs and location, or empty for registration.
 * @param {object | null} dev - the signed-in user's dev (GET /devs/me), or null
 * @returns {{ techs: string, latitude: string, longitude: string }}
 */
function initialValues(dev) {
  if (!dev) return { techs: '', latitude: '', longitude: '' };
  const coordinates = dev.location && Array.isArray(dev.location.coordinates) ? dev.location.coordinates : [];
  return {
    techs: Array.isArray(dev.techs) ? dev.techs.join(', ') : '',
    latitude: coordinates.length === 2 ? String(coordinates[1]) : '',
    longitude: coordinates.length === 2 ? String(coordinates[0]) : '',
  };
}

// The signed-in developer's own profile. The GitHub username comes from the session token, so
// the form only asks for techs and location.
//   - no profile (`dev` null): registration, "Salvar", location pre-filled from the browser;
//   - with a profile (US-6 "Already registered"): pre-filled with the saved techs and location,
//     "Atualizar", and "Excluir meu perfil" behind an in-page confirmation (no window.confirm:
//     native dialogs block the page and browser automation).
// The parent remounts the form (React `key`) after every save or delete, so it always starts
// from the saved values.
function DevForm({ dev = null, onSubmit, onDelete }) {
  const editing = Boolean(dev);
  const [initial] = useState(() => initialValues(dev));
  const [techs, setTechs] = useState(initial.techs);
  const [latitude, setLatitude] = useState(initial.latitude);
  const [longitude, setLongitude] = useState(initial.longitude);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // One request at a time (QA-AUTH2-1): every button is disabled while a save or a delete is in
  // flight, and the ref also stops a second click that arrives before the re-render.
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(null);

  // An update keeps the saved location: only registration asks the browser where it is.
  useEffect(() => {
    if (editing) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;

        setLatitude(latitude);
        setLongitude(longitude);
      },
      (err) => {
        console.log(err);
      }
    );
  }, [editing]);

  /**
   * Runs `request` unless another one is in flight. A failure is already shown by the parent;
   * the fields are kept so the user can correct them.
   * @param {'save' | 'delete'} kind
   * @param {() => Promise<unknown>} request
   */
  async function run(kind, request) {
    if (pendingRef.current) return;

    pendingRef.current = kind;
    setPending(kind);
    try {
      await request();
    } catch {
      setConfirmingDelete(false);
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    run('save', () => onSubmit({
      techs,
      latitude,
      longitude,
    }));
  }

  function handleDelete() {
    run('delete', () => onDelete());
  }

  const busy = pending !== null;

  return (
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

      <button type="submit" disabled={busy}>{editing ? 'Atualizar' : 'Salvar'}</button>

      {editing && !confirmingDelete && (
        <button type="button" className="delete-profile" disabled={busy} onClick={() => setConfirmingDelete(true)}>
          Excluir meu perfil
        </button>
      )}

      {editing && confirmingDelete && (
        <div className="delete-confirmation" role="group" aria-labelledby="delete-confirmation-text">
          <p id="delete-confirmation-text">
            Excluir seu perfil do DevRadar? Ele deixa de aparecer para outros devs.
          </p>
          <div className="delete-confirmation-actions">
            <button type="button" className="confirm-delete" disabled={busy} onClick={handleDelete}>
              Confirmar exclusão
            </button>
            <button type="button" className="cancel-delete" disabled={busy} onClick={() => setConfirmingDelete(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </form>

  );
}

export default DevForm;
