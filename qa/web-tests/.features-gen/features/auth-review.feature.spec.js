// Generated from: features/auth-review.feature
import { test } from "playwright-bdd";

test.describe('QA review of GitHub sign-in slices 2 and 3, web (defects found in review)', () => {

  test('Double-clicking "Salvar" registers the signed-in developer once', { tag: ['@edge', '@regression', '@P1'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"', null, { context }); 
    await And('the backend has no registered developers'); 
    await And('I am signed in with GitHub as "gaearon"', null, { context, page }); 
    await When('I fill in techs "ReactJS" and double-click submit', null, { page }); 
    await Then('the backend should have exactly 1 developer, "gaearon"'); 
    await And('reloading the page should show exactly 1 entry for "gaearon"', null, { page }); 
  });

  test('A tab never registers someone other than the user it shows', { tag: ['@edge', '@regression', '@P2'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"', null, { context }); 
    await And('the backend has no registered developers'); 
    await And('I am signed in with GitHub as "gaearon"', null, { context, page }); 
    await And('GitHub will sign me in as "alice"', null, { context }); 
    await When('in a second tab I sign out and sign in with GitHub', null, { context }); 
    await And('I fill in techs "ReactJS" and submit in the first tab', null, { context, page }); 
    await Then('the developer registered from the first tab should be the user it showed', null, { context }); 
  });

  test('Signing out in another tab signs this tab out too', { tag: ['@edge', '@regression', '@P2'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the backend has 2 registered developers'); 
    await And('I am signed in with GitHub as "gaearon"', null, { context, page }); 
    await When('in a second tab I sign out', null, { context }); 
    await Then('the first tab should eventually show the signed-out view', null, { page }); 
  });

  test.describe('A 401 with an unrecognised body on load shows the signed-out view', () => {

    test('Example #1', { tag: ['@edge', '@regression', '@P2'] }, async ({ Given, When, Then, page }) => { 
      await Given('the backend answers GET /auth/me with 401 and body \'{"error":"Session revoked","code":"session_revoked"}\'', null, { page }); 
      await When('I open the DevRadar web app with a stored session token for "gaearon"', null, { page }); 
      await Then('I should see the signed-out view', null, { page }); 
    });

    test('Example #2', { tag: ['@edge', '@regression', '@P2'] }, async ({ Given, When, Then, page }) => { 
      await Given('the backend answers GET /auth/me with 401 and body \'{"error":"Unauthorized"}\'', null, { page }); 
      await When('I open the DevRadar web app with a stored session token for "gaearon"', null, { page }); 
      await Then('I should see the signed-out view', null, { page }); 
    });

  });

  test('A 401 with an unrecognised code on registration is not silently ignored', { tag: ['@edge', '@regression', '@P2'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"', null, { context }); 
    await And('the backend has no registered developers'); 
    await And('I am signed in with GitHub as "gaearon"', null, { context, page }); 
    await And('the backend answers POST /devs with 401 and body \'{"error":"Session revoked","code":"session_revoked"}\'', null, { page }); 
    await When('I fill in techs "ReactJS" and submit', null, { page }); 
    await Then('I should get visible feedback that the registration did not happen', null, { page }); 
  });

  test('A sign-in callback link opened while signed in does not show me signed out while my session is still stored', { tag: ['@edge', '@regression', '@P2'] }, async ({ Given, When, Then, context, page }) => { 
    await Given('I am signed in with GitHub as "gaearon"', null, { context, page }); 
    await When('I open the sign-in callback link "/auth/callback?code=stolen-code"', null, { page }); 
    await Then('the view should match the stored session', null, { page }); 
  });

});

// == technical section ==

test.beforeEach('BeforeEach Hooks', ({ $runScenarioHooks, context }) => $runScenarioHooks('before', { context }));
test.afterEach('AfterEach Hooks', ({ $runScenarioHooks, context }) => $runScenarioHooks('after', { context }));

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('features/auth-review.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":16,"tags":["@edge","@regression","@P1"],"steps":[{"pwStepLine":7,"gherkinStepLine":17,"keywordType":"Context","textWithKeyword":"Given the browser grants geolocation permission at latitude \"-23.5505\" and longitude \"-46.6333\"","stepMatchArguments":[{"group":{"start":54,"value":"\"-23.5505\"","children":[{"start":55,"value":"-23.5505","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":79,"value":"\"-46.6333\"","children":[{"start":80,"value":"-46.6333","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":18,"keywordType":"Context","textWithKeyword":"And the backend has no registered developers","stepMatchArguments":[]},{"pwStepLine":9,"gherkinStepLine":19,"keywordType":"Context","textWithKeyword":"And I am signed in with GitHub as \"gaearon\"","stepMatchArguments":[{"group":{"start":30,"value":"\"gaearon\"","children":[{"start":31,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":10,"gherkinStepLine":20,"keywordType":"Action","textWithKeyword":"When I fill in techs \"ReactJS\" and double-click submit","stepMatchArguments":[{"group":{"start":16,"value":"\"ReactJS\"","children":[{"start":17,"value":"ReactJS","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":11,"gherkinStepLine":21,"keywordType":"Outcome","textWithKeyword":"Then the backend should have exactly 1 developer, \"gaearon\"","stepMatchArguments":[{"group":{"start":32,"value":"1"},"parameterTypeName":"int"},{"group":{"start":45,"value":"\"gaearon\"","children":[{"start":46,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":12,"gherkinStepLine":22,"keywordType":"Outcome","textWithKeyword":"And reloading the page should show exactly 1 entry for \"gaearon\"","stepMatchArguments":[{"group":{"start":39,"value":"1"},"parameterTypeName":"int"},{"group":{"start":51,"value":"\"gaearon\"","children":[{"start":52,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
  {"pwTestLine":15,"pickleLine":30,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":16,"gherkinStepLine":31,"keywordType":"Context","textWithKeyword":"Given the browser grants geolocation permission at latitude \"-23.5505\" and longitude \"-46.6333\"","stepMatchArguments":[{"group":{"start":54,"value":"\"-23.5505\"","children":[{"start":55,"value":"-23.5505","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":79,"value":"\"-46.6333\"","children":[{"start":80,"value":"-46.6333","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":17,"gherkinStepLine":32,"keywordType":"Context","textWithKeyword":"And the backend has no registered developers","stepMatchArguments":[]},{"pwStepLine":18,"gherkinStepLine":33,"keywordType":"Context","textWithKeyword":"And I am signed in with GitHub as \"gaearon\"","stepMatchArguments":[{"group":{"start":30,"value":"\"gaearon\"","children":[{"start":31,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":19,"gherkinStepLine":34,"keywordType":"Context","textWithKeyword":"And GitHub will sign me in as \"alice\"","stepMatchArguments":[{"group":{"start":26,"value":"\"alice\"","children":[{"start":27,"value":"alice","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":20,"gherkinStepLine":35,"keywordType":"Action","textWithKeyword":"When in a second tab I sign out and sign in with GitHub","stepMatchArguments":[]},{"pwStepLine":21,"gherkinStepLine":36,"keywordType":"Action","textWithKeyword":"And I fill in techs \"ReactJS\" and submit in the first tab","stepMatchArguments":[{"group":{"start":16,"value":"\"ReactJS\"","children":[{"start":17,"value":"ReactJS","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":22,"gherkinStepLine":37,"keywordType":"Outcome","textWithKeyword":"Then the developer registered from the first tab should be the user it showed","stepMatchArguments":[]}]},
  {"pwTestLine":25,"pickleLine":40,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":26,"gherkinStepLine":41,"keywordType":"Context","textWithKeyword":"Given the backend has 2 registered developers","stepMatchArguments":[{"group":{"start":16,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":27,"gherkinStepLine":42,"keywordType":"Context","textWithKeyword":"And I am signed in with GitHub as \"gaearon\"","stepMatchArguments":[{"group":{"start":30,"value":"\"gaearon\"","children":[{"start":31,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":28,"gherkinStepLine":43,"keywordType":"Action","textWithKeyword":"When in a second tab I sign out","stepMatchArguments":[]},{"pwStepLine":29,"gherkinStepLine":44,"keywordType":"Outcome","textWithKeyword":"Then the first tab should eventually show the signed-out view","stepMatchArguments":[]}]},
  {"pwTestLine":34,"pickleLine":59,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":35,"gherkinStepLine":53,"keywordType":"Context","textWithKeyword":"Given the backend answers GET /auth/me with 401 and body '{\"error\":\"Session revoked\",\"code\":\"session_revoked\"}'","stepMatchArguments":[{"group":{"start":38,"value":"401"},"parameterTypeName":"int"},{"group":{"start":51,"value":"'{\"error\":\"Session revoked\",\"code\":\"session_revoked\"}'","children":[{"children":[{}]},{"start":52,"value":"{\"error\":\"Session revoked\",\"code\":\"session_revoked\"}","children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":36,"gherkinStepLine":54,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app with a stored session token for \"gaearon\"","stepMatchArguments":[{"group":{"start":60,"value":"\"gaearon\"","children":[{"start":61,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":37,"gherkinStepLine":55,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]}]},
  {"pwTestLine":40,"pickleLine":60,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":41,"gherkinStepLine":53,"keywordType":"Context","textWithKeyword":"Given the backend answers GET /auth/me with 401 and body '{\"error\":\"Unauthorized\"}'","stepMatchArguments":[{"group":{"start":38,"value":"401"},"parameterTypeName":"int"},{"group":{"start":51,"value":"'{\"error\":\"Unauthorized\"}'","children":[{"children":[{}]},{"start":52,"value":"{\"error\":\"Unauthorized\"}","children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":42,"gherkinStepLine":54,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app with a stored session token for \"gaearon\"","stepMatchArguments":[{"group":{"start":60,"value":"\"gaearon\"","children":[{"start":61,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":43,"gherkinStepLine":55,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]}]},
  {"pwTestLine":48,"pickleLine":63,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":49,"gherkinStepLine":64,"keywordType":"Context","textWithKeyword":"Given the browser grants geolocation permission at latitude \"-23.5505\" and longitude \"-46.6333\"","stepMatchArguments":[{"group":{"start":54,"value":"\"-23.5505\"","children":[{"start":55,"value":"-23.5505","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":79,"value":"\"-46.6333\"","children":[{"start":80,"value":"-46.6333","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":50,"gherkinStepLine":65,"keywordType":"Context","textWithKeyword":"And the backend has no registered developers","stepMatchArguments":[]},{"pwStepLine":51,"gherkinStepLine":66,"keywordType":"Context","textWithKeyword":"And I am signed in with GitHub as \"gaearon\"","stepMatchArguments":[{"group":{"start":30,"value":"\"gaearon\"","children":[{"start":31,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":52,"gherkinStepLine":67,"keywordType":"Context","textWithKeyword":"And the backend answers POST /devs with 401 and body '{\"error\":\"Session revoked\",\"code\":\"session_revoked\"}'","stepMatchArguments":[{"group":{"start":36,"value":"401"},"parameterTypeName":"int"},{"group":{"start":49,"value":"'{\"error\":\"Session revoked\",\"code\":\"session_revoked\"}'","children":[{"children":[{}]},{"start":50,"value":"{\"error\":\"Session revoked\",\"code\":\"session_revoked\"}","children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":53,"gherkinStepLine":68,"keywordType":"Action","textWithKeyword":"When I fill in techs \"ReactJS\" and submit","stepMatchArguments":[{"group":{"start":16,"value":"\"ReactJS\"","children":[{"start":17,"value":"ReactJS","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":54,"gherkinStepLine":69,"keywordType":"Outcome","textWithKeyword":"Then I should get visible feedback that the registration did not happen","stepMatchArguments":[]}]},
  {"pwTestLine":57,"pickleLine":76,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":58,"gherkinStepLine":77,"keywordType":"Context","textWithKeyword":"Given I am signed in with GitHub as \"gaearon\"","stepMatchArguments":[{"group":{"start":30,"value":"\"gaearon\"","children":[{"start":31,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":59,"gherkinStepLine":78,"keywordType":"Action","textWithKeyword":"When I open the sign-in callback link \"/auth/callback?code=stolen-code\"","stepMatchArguments":[{"group":{"start":33,"value":"\"/auth/callback?code=stolen-code\"","children":[{"start":34,"value":"/auth/callback?code=stolen-code","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":60,"gherkinStepLine":79,"keywordType":"Outcome","textWithKeyword":"Then the view should match the stored session","stepMatchArguments":[]}]},
]; // bdd-data-end