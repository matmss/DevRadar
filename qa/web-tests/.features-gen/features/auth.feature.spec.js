// Generated from: features/auth.feature
import { test } from "playwright-bdd";

test.describe('Sign in and out of the web app with GitHub (US-6)', () => {

  test('Signed out, I only see the sign-in button', { tag: ['@smoke', '@P1'] }, async ({ Given, When, Then, page }) => { 
    await Given('the backend has 2 registered developers'); 
    await When('I open the DevRadar web app', null, { page }); 
    await Then('I should see the signed-out view', null, { page }); 
  });

  test('Signing in shows my GitHub username and avatar, the form and the dev list', { tag: ['@smoke', '@P1'] }, async ({ Given, When, Then, And, baseURL, context, page }) => { 
    await Given('the backend has 2 registered developers'); 
    await And('GitHub will sign me in as "gaearon"', null, { context }); 
    await When('I open the DevRadar web app', null, { page }); 
    await And('I sign in with GitHub', null, { page }); 
    await Then('I should be signed in as "gaearon"', null, { page }); 
    await And('I should see the registration form', null, { page }); 
    await And('the developer list should show 2 entries', null, { page }); 
    await And('GitHub should have been asked for sign-in with a state and no extra scope', null, { context }); 
    await And('the address bar should show the app without a sign-in code', null, { baseURL, page }); 
    await And('the PKCE verifier should be cleared', null, { page }); 
  });

  test('The session survives a page reload', { tag: ['@regression', '@P1'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('I am signed in with GitHub as "gaearon"', null, { context, page }); 
    await When('I reload the page', null, { page }); 
    await Then('I should be signed in as "gaearon"', null, { page }); 
    await And('I should see the registration form', null, { page }); 
  });

  test('Signing out clears the session and hides the app', { tag: ['@regression', '@P1'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the backend has 2 registered developers'); 
    await And('I am signed in with GitHub as "gaearon"', null, { context, page }); 
    await When('I sign out', null, { page }); 
    await Then('I should see the signed-out view', null, { page }); 
    await And('the session token should be cleared', null, { page }); 
    await When('I reload the page', null, { page }); 
    await Then('I should see the signed-out view', null, { page }); 
  });

  test('Cancelling on GitHub shows "sign-in cancelled", and I can retry', { tag: ['@regression', '@P1'] }, async ({ Given, When, Then, And, baseURL, context, page }) => { 
    await Given('I will cancel on GitHub\'s consent page', null, { context }); 
    await When('I open the DevRadar web app', null, { page }); 
    await And('I sign in with GitHub', null, { page }); 
    await Then('I should see the signed-out view', null, { page }); 
    await And('I should see the message "Login cancelado"', null, { page }); 
    await And('the address bar should show the app without a sign-in code', null, { baseURL, page }); 
    await Given('GitHub will sign me in as "gaearon"', null, { context }); 
    await When('I sign in with GitHub', null, { page }); 
    await Then('I should be signed in as "gaearon"', null, { page }); 
  });

  test('A GitHub failure during sign-in shows a clear message', { tag: ['@edge', '@regression', '@P2'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('GitHub will fail to sign me in', null, { context }); 
    await When('I open the DevRadar web app', null, { page }); 
    await And('I sign in with GitHub', null, { page }); 
    await Then('I should see the signed-out view', null, { page }); 
    await And('I should see the message "Não foi possível falar com o GitHub, tente novamente"', null, { page }); 
  });

  test('An expired session on load returns to the signed-out view with a message', { tag: ['@edge', '@regression', '@P1'] }, async ({ Given, When, Then, And, page }) => { 
    await Given('the backend has 2 registered developers'); 
    await When('I open the DevRadar web app with an expired session token for "gaearon"', null, { page }); 
    await Then('I should see the signed-out view', null, { page }); 
    await And('I should see the message "Sessão expirada, entre novamente"', null, { page }); 
    await And('the session token should be cleared', null, { page }); 
  });

  test('An invalid session token on load returns to the signed-out view without a message', { tag: ['@edge', '@regression', '@P2'] }, async ({ When, Then, And, page }) => { 
    await When('I open the DevRadar web app with the session token "not-a-jwt"', null, { page }); 
    await Then('I should see the signed-out view', null, { page }); 
    await And('I should see no message', null, { page }); 
    await And('the session token should be cleared', null, { page }); 
  });

  test('A rate-limited session check keeps the session and says to try again later', { tag: ['@edge', '@regression', '@P2'] }, async ({ Given, When, Then, And, page }) => { 
    await Given('the backend answers GET /auth/me with 429 and body \'{"error":"Too many requests","code":"rate_limited","details":[]}\'', null, { page }); 
    await When('I open the DevRadar web app with a stored session token for "gaearon"', null, { page }); 
    await Then('I should see the message "Muitas tentativas em pouco tempo, tente novamente mais tarde"', null, { page }); 
    await And('I should be offered to try again or sign out, with my session kept', null, { page }); 
    await When('I try again', null, { page }); 
    await Then('I should be signed in as "gaearon"', null, { page }); 
  });

  test.describe('A forged sign-in callback link does not sign me in or navigate away', () => {

    test('Example #1', { tag: ['@edge', '@regression', '@P1'] }, async ({ When, Then, And, baseURL, page }) => { 
      await When('I open the sign-in callback link "/auth/callback?code=stolen-code"', null, { page }); 
      await Then('I should see the signed-out view', null, { page }); 
      await And('I should see the message "Não foi possível entrar com o GitHub, tente novamente"', null, { page }); 
      await And('the address bar should show the app without a sign-in code', null, { baseURL, page }); 
    });

    test('Example #2', { tag: ['@edge', '@regression', '@P1'] }, async ({ When, Then, And, baseURL, page }) => { 
      await When('I open the sign-in callback link "/auth/callback?code=stolen-code&redirect=//evil.example/"', null, { page }); 
      await Then('I should see the signed-out view', null, { page }); 
      await And('I should see the message "Não foi possível entrar com o GitHub, tente novamente"', null, { page }); 
      await And('the address bar should show the app without a sign-in code', null, { baseURL, page }); 
    });

    test('Example #3', { tag: ['@edge', '@regression', '@P1'] }, async ({ When, Then, And, baseURL, page }) => { 
      await When('I open the sign-in callback link "/auth/callback?error=sign_in_failed&reason=<script>x</script>"', null, { page }); 
      await Then('I should see the signed-out view', null, { page }); 
      await And('I should see the message "Não foi possível entrar com o GitHub, tente novamente"', null, { page }); 
      await And('the address bar should show the app without a sign-in code', null, { baseURL, page }); 
    });

  });

});

// == technical section ==

test.beforeEach('BeforeEach Hooks', ({ $runScenarioHooks, context }) => $runScenarioHooks('before', { context }));
test.afterEach('AfterEach Hooks', ({ $runScenarioHooks, context }) => $runScenarioHooks('after', { context }));

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('features/auth.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":13,"tags":["@smoke","@P1"],"steps":[{"pwStepLine":7,"gherkinStepLine":14,"keywordType":"Context","textWithKeyword":"Given the backend has 2 registered developers","stepMatchArguments":[{"group":{"start":16,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":8,"gherkinStepLine":15,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":9,"gherkinStepLine":16,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]}]},
  {"pwTestLine":12,"pickleLine":19,"tags":["@smoke","@P1"],"steps":[{"pwStepLine":13,"gherkinStepLine":20,"keywordType":"Context","textWithKeyword":"Given the backend has 2 registered developers","stepMatchArguments":[{"group":{"start":16,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":14,"gherkinStepLine":21,"keywordType":"Context","textWithKeyword":"And GitHub will sign me in as \"gaearon\"","stepMatchArguments":[{"group":{"start":26,"value":"\"gaearon\"","children":[{"start":27,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":15,"gherkinStepLine":22,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":16,"gherkinStepLine":23,"keywordType":"Action","textWithKeyword":"And I sign in with GitHub","stepMatchArguments":[]},{"pwStepLine":17,"gherkinStepLine":24,"keywordType":"Outcome","textWithKeyword":"Then I should be signed in as \"gaearon\"","stepMatchArguments":[{"group":{"start":25,"value":"\"gaearon\"","children":[{"start":26,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":18,"gherkinStepLine":25,"keywordType":"Outcome","textWithKeyword":"And I should see the registration form","stepMatchArguments":[]},{"pwStepLine":19,"gherkinStepLine":26,"keywordType":"Outcome","textWithKeyword":"And the developer list should show 2 entries","stepMatchArguments":[{"group":{"start":31,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":20,"gherkinStepLine":27,"keywordType":"Outcome","textWithKeyword":"And GitHub should have been asked for sign-in with a state and no extra scope","stepMatchArguments":[]},{"pwStepLine":21,"gherkinStepLine":28,"keywordType":"Outcome","textWithKeyword":"And the address bar should show the app without a sign-in code","stepMatchArguments":[]},{"pwStepLine":22,"gherkinStepLine":29,"keywordType":"Outcome","textWithKeyword":"And the PKCE verifier should be cleared","stepMatchArguments":[]}]},
  {"pwTestLine":25,"pickleLine":32,"tags":["@regression","@P1"],"steps":[{"pwStepLine":26,"gherkinStepLine":33,"keywordType":"Context","textWithKeyword":"Given I am signed in with GitHub as \"gaearon\"","stepMatchArguments":[{"group":{"start":30,"value":"\"gaearon\"","children":[{"start":31,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":27,"gherkinStepLine":34,"keywordType":"Action","textWithKeyword":"When I reload the page","stepMatchArguments":[]},{"pwStepLine":28,"gherkinStepLine":35,"keywordType":"Outcome","textWithKeyword":"Then I should be signed in as \"gaearon\"","stepMatchArguments":[{"group":{"start":25,"value":"\"gaearon\"","children":[{"start":26,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":29,"gherkinStepLine":36,"keywordType":"Outcome","textWithKeyword":"And I should see the registration form","stepMatchArguments":[]}]},
  {"pwTestLine":32,"pickleLine":39,"tags":["@regression","@P1"],"steps":[{"pwStepLine":33,"gherkinStepLine":40,"keywordType":"Context","textWithKeyword":"Given the backend has 2 registered developers","stepMatchArguments":[{"group":{"start":16,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":34,"gherkinStepLine":41,"keywordType":"Context","textWithKeyword":"And I am signed in with GitHub as \"gaearon\"","stepMatchArguments":[{"group":{"start":30,"value":"\"gaearon\"","children":[{"start":31,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":35,"gherkinStepLine":42,"keywordType":"Action","textWithKeyword":"When I sign out","stepMatchArguments":[]},{"pwStepLine":36,"gherkinStepLine":43,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]},{"pwStepLine":37,"gherkinStepLine":44,"keywordType":"Outcome","textWithKeyword":"And the session token should be cleared","stepMatchArguments":[]},{"pwStepLine":38,"gherkinStepLine":45,"keywordType":"Action","textWithKeyword":"When I reload the page","stepMatchArguments":[]},{"pwStepLine":39,"gherkinStepLine":46,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]}]},
  {"pwTestLine":42,"pickleLine":49,"tags":["@regression","@P1"],"steps":[{"pwStepLine":43,"gherkinStepLine":50,"keywordType":"Context","textWithKeyword":"Given I will cancel on GitHub's consent page","stepMatchArguments":[]},{"pwStepLine":44,"gherkinStepLine":51,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":45,"gherkinStepLine":52,"keywordType":"Action","textWithKeyword":"And I sign in with GitHub","stepMatchArguments":[]},{"pwStepLine":46,"gherkinStepLine":53,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]},{"pwStepLine":47,"gherkinStepLine":54,"keywordType":"Outcome","textWithKeyword":"And I should see the message \"Login cancelado\"","stepMatchArguments":[{"group":{"start":25,"value":"\"Login cancelado\"","children":[{"start":26,"value":"Login cancelado","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":48,"gherkinStepLine":55,"keywordType":"Outcome","textWithKeyword":"And the address bar should show the app without a sign-in code","stepMatchArguments":[]},{"pwStepLine":49,"gherkinStepLine":56,"keywordType":"Context","textWithKeyword":"Given GitHub will sign me in as \"gaearon\"","stepMatchArguments":[{"group":{"start":26,"value":"\"gaearon\"","children":[{"start":27,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":50,"gherkinStepLine":57,"keywordType":"Action","textWithKeyword":"When I sign in with GitHub","stepMatchArguments":[]},{"pwStepLine":51,"gherkinStepLine":58,"keywordType":"Outcome","textWithKeyword":"Then I should be signed in as \"gaearon\"","stepMatchArguments":[{"group":{"start":25,"value":"\"gaearon\"","children":[{"start":26,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
  {"pwTestLine":54,"pickleLine":61,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":55,"gherkinStepLine":62,"keywordType":"Context","textWithKeyword":"Given GitHub will fail to sign me in","stepMatchArguments":[]},{"pwStepLine":56,"gherkinStepLine":63,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":57,"gherkinStepLine":64,"keywordType":"Action","textWithKeyword":"And I sign in with GitHub","stepMatchArguments":[]},{"pwStepLine":58,"gherkinStepLine":65,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]},{"pwStepLine":59,"gherkinStepLine":66,"keywordType":"Outcome","textWithKeyword":"And I should see the message \"Não foi possível falar com o GitHub, tente novamente\"","stepMatchArguments":[{"group":{"start":25,"value":"\"Não foi possível falar com o GitHub, tente novamente\"","children":[{"start":26,"value":"Não foi possível falar com o GitHub, tente novamente","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
  {"pwTestLine":62,"pickleLine":69,"tags":["@edge","@regression","@P1"],"steps":[{"pwStepLine":63,"gherkinStepLine":70,"keywordType":"Context","textWithKeyword":"Given the backend has 2 registered developers","stepMatchArguments":[{"group":{"start":16,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":64,"gherkinStepLine":71,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app with an expired session token for \"gaearon\"","stepMatchArguments":[{"group":{"start":62,"value":"\"gaearon\"","children":[{"start":63,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":65,"gherkinStepLine":72,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]},{"pwStepLine":66,"gherkinStepLine":73,"keywordType":"Outcome","textWithKeyword":"And I should see the message \"Sessão expirada, entre novamente\"","stepMatchArguments":[{"group":{"start":25,"value":"\"Sessão expirada, entre novamente\"","children":[{"start":26,"value":"Sessão expirada, entre novamente","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":67,"gherkinStepLine":74,"keywordType":"Outcome","textWithKeyword":"And the session token should be cleared","stepMatchArguments":[]}]},
  {"pwTestLine":70,"pickleLine":77,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":71,"gherkinStepLine":78,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app with the session token \"not-a-jwt\"","stepMatchArguments":[{"group":{"start":51,"value":"\"not-a-jwt\"","children":[{"start":52,"value":"not-a-jwt","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":72,"gherkinStepLine":79,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]},{"pwStepLine":73,"gherkinStepLine":80,"keywordType":"Outcome","textWithKeyword":"And I should see no message","stepMatchArguments":[]},{"pwStepLine":74,"gherkinStepLine":81,"keywordType":"Outcome","textWithKeyword":"And the session token should be cleared","stepMatchArguments":[]}]},
  {"pwTestLine":77,"pickleLine":85,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":78,"gherkinStepLine":86,"keywordType":"Context","textWithKeyword":"Given the backend answers GET /auth/me with 429 and body '{\"error\":\"Too many requests\",\"code\":\"rate_limited\",\"details\":[]}'","stepMatchArguments":[{"group":{"start":38,"value":"429"},"parameterTypeName":"int"},{"group":{"start":51,"value":"'{\"error\":\"Too many requests\",\"code\":\"rate_limited\",\"details\":[]}'","children":[{"children":[{}]},{"start":52,"value":"{\"error\":\"Too many requests\",\"code\":\"rate_limited\",\"details\":[]}","children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":79,"gherkinStepLine":87,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app with a stored session token for \"gaearon\"","stepMatchArguments":[{"group":{"start":60,"value":"\"gaearon\"","children":[{"start":61,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":80,"gherkinStepLine":88,"keywordType":"Outcome","textWithKeyword":"Then I should see the message \"Muitas tentativas em pouco tempo, tente novamente mais tarde\"","stepMatchArguments":[{"group":{"start":25,"value":"\"Muitas tentativas em pouco tempo, tente novamente mais tarde\"","children":[{"start":26,"value":"Muitas tentativas em pouco tempo, tente novamente mais tarde","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":81,"gherkinStepLine":89,"keywordType":"Outcome","textWithKeyword":"And I should be offered to try again or sign out, with my session kept","stepMatchArguments":[]},{"pwStepLine":82,"gherkinStepLine":90,"keywordType":"Action","textWithKeyword":"When I try again","stepMatchArguments":[]},{"pwStepLine":83,"gherkinStepLine":91,"keywordType":"Outcome","textWithKeyword":"Then I should be signed in as \"gaearon\"","stepMatchArguments":[{"group":{"start":25,"value":"\"gaearon\"","children":[{"start":26,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
  {"pwTestLine":88,"pickleLine":104,"tags":["@edge","@regression","@P1"],"steps":[{"pwStepLine":89,"gherkinStepLine":97,"keywordType":"Action","textWithKeyword":"When I open the sign-in callback link \"/auth/callback?code=stolen-code\"","stepMatchArguments":[{"group":{"start":33,"value":"\"/auth/callback?code=stolen-code\"","children":[{"start":34,"value":"/auth/callback?code=stolen-code","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":90,"gherkinStepLine":98,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]},{"pwStepLine":91,"gherkinStepLine":99,"keywordType":"Outcome","textWithKeyword":"And I should see the message \"Não foi possível entrar com o GitHub, tente novamente\"","stepMatchArguments":[{"group":{"start":25,"value":"\"Não foi possível entrar com o GitHub, tente novamente\"","children":[{"start":26,"value":"Não foi possível entrar com o GitHub, tente novamente","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":92,"gherkinStepLine":100,"keywordType":"Outcome","textWithKeyword":"And the address bar should show the app without a sign-in code","stepMatchArguments":[]}]},
  {"pwTestLine":95,"pickleLine":105,"tags":["@edge","@regression","@P1"],"steps":[{"pwStepLine":96,"gherkinStepLine":97,"keywordType":"Action","textWithKeyword":"When I open the sign-in callback link \"/auth/callback?code=stolen-code&redirect=//evil.example/\"","stepMatchArguments":[{"group":{"start":33,"value":"\"/auth/callback?code=stolen-code&redirect=//evil.example/\"","children":[{"start":34,"value":"/auth/callback?code=stolen-code&redirect=//evil.example/","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":97,"gherkinStepLine":98,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]},{"pwStepLine":98,"gherkinStepLine":99,"keywordType":"Outcome","textWithKeyword":"And I should see the message \"Não foi possível entrar com o GitHub, tente novamente\"","stepMatchArguments":[{"group":{"start":25,"value":"\"Não foi possível entrar com o GitHub, tente novamente\"","children":[{"start":26,"value":"Não foi possível entrar com o GitHub, tente novamente","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":99,"gherkinStepLine":100,"keywordType":"Outcome","textWithKeyword":"And the address bar should show the app without a sign-in code","stepMatchArguments":[]}]},
  {"pwTestLine":102,"pickleLine":106,"tags":["@edge","@regression","@P1"],"steps":[{"pwStepLine":103,"gherkinStepLine":97,"keywordType":"Action","textWithKeyword":"When I open the sign-in callback link \"/auth/callback?error=sign_in_failed&reason=<script>x</script>\"","stepMatchArguments":[{"group":{"start":33,"value":"\"/auth/callback?error=sign_in_failed&reason=<script>x</script>\"","children":[{"start":34,"value":"/auth/callback?error=sign_in_failed&reason=<script>x</script>","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":104,"gherkinStepLine":98,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]},{"pwStepLine":105,"gherkinStepLine":99,"keywordType":"Outcome","textWithKeyword":"And I should see the message \"Não foi possível entrar com o GitHub, tente novamente\"","stepMatchArguments":[{"group":{"start":25,"value":"\"Não foi possível entrar com o GitHub, tente novamente\"","children":[{"start":26,"value":"Não foi possível entrar com o GitHub, tente novamente","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":106,"gherkinStepLine":100,"keywordType":"Outcome","textWithKeyword":"And the address bar should show the app without a sign-in code","stepMatchArguments":[]}]},
]; // bdd-data-end