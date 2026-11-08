import React, { useState, useEffect } from 'react';
import api from './services/api'

import './Global.css'
import './App.css'
import './Sidebar.css'
import './Main.css'

import DevItem from './components/DevItem';
import DevForm from './components/DevForm';

function App() {
const [devs, setDevs] = useState([]);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    async function loadDevs(){
      const response = await api.get('/devs');

      setDevs(response.data);
    }

    loadDevs();
  }, []);

  async function handleAddDev(data) {
    setFormError(null);

    try {
      const response = await api.post('/devs', data);

      // The backend returns the existing record when the dev is already registered.
      if (!devs.some(dev => dev._id === response.data._id)) {
        setDevs([...devs, response.data]);
      }
    } catch (err) {
      const body = err.response && err.response.data;
      const details = body && Array.isArray(body.details) && body.details.length > 0
        ? `: ${body.details.join('; ')}`
        : '';
      setFormError(body && body.error
        ? `${body.error}${details}`
        : 'Could not reach the server, try again later');

      // Rethrow so DevForm keeps the user's input instead of clearing it.
      throw err;
    }
  }

  return (
    <div id="app">
      <aside>
        <strong>Cadastro</strong>
        <DevForm onSubmit={handleAddDev} />
        {formError && <p className="form-error" role="alert">{formError}</p>}
      </aside>

      <main>
        <ul>
          {devs.map(dev => (
            <DevItem key={dev._id} dev={dev} />
          ))}
        </ul>
      </main>
    </div>
  );
}

export default App;
