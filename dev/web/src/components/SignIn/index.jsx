import React, { useState } from 'react';

import './styles.css';

// The signed-out view: no form and no dev list, only the sign-in button and, after a failed,
// cancelled or expired session, a message. The button is also the retry.
function SignIn({ notice, onSignIn }) {
  const [starting, setStarting] = useState(false);

  async function handleClick() {
    setStarting(true);
    try {
      await onSignIn();
    } catch {
      // onSignIn reports the problem through `notice`; let the user try again.
      setStarting(false);
    }
  }

  return (
    <section className="sign-in">
      <strong>DevRadar</strong>
      <p className="sign-in-text">Entre com sua conta do GitHub para se cadastrar e ver os devs.</p>
      {notice && <p className="sign-in-notice" role="alert">{notice}</p>}
      <button type="button" className="sign-in-button" onClick={handleClick} disabled={starting}>
        Entrar com GitHub
      </button>
    </section>
  );
}

export default SignIn;
