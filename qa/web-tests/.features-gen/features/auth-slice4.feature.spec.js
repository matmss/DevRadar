// Generated from: features/auth-slice4.feature
import { test } from "playwright-bdd";

test.describe('Protected developer list and session robustness in the web app (auth slice 4)', () => {

  test('The developer list is requested with my session token', { tag: ['@smoke', '@P1'] }, async ({ Given, Then, And, context, page }) => { 
    await Given('the backend has 2 registered developers'); 
    await And('I am signed in with GitHub as "gaearon"', null, { context, page }); 
    await Then('the developer list should show 2 entries', null, { page }); 
    await And('reloading the page should request the developer list with my session token', null, { page }); 
  });

  test('A 401 on the developer list signs me out', { tag: ['@edge', '@regression', '@P1'] }, async ({ Given, When, Then, And, page }) => { 
    await Given('the backend has 2 registered developers'); 
    await And('the backend answers GET /devs with 401 and body \'{"error":"Session expired, sign in again","code":"token_expired","details":[]}\'', null, { page }); 
    await When('I open the DevRadar web app with a stored session token for "gaearon"', null, { page }); 
    await Then('I should see the signed-out view', null, { page }); 
    await And('I should see the message "Sessão expirada, entre novamente"', null, { page }); 
    await And('the session token should be cleared', null, { page }); 
  });

  test('A 401 for a token another tab has replaced keeps the new session', { tag: ['@edge', '@regression', '@P2'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('I am signed in with GitHub as "gaearon"', null, { context, page }); 
    await And('the next GET /devs will be answered 401 "token_expired" after another tab signs in as "alice"', null, { page }); 
    await When('I reload the page', null, { page }); 
    await Then('I should be signed in as "alice"', null, { page }); 
    await And('the stored session token should belong to "alice"', null, { page }); 
  });

  test('A session check that never answers shows the "unavailable" view instead of loading forever', { tag: ['@edge', '@regression', '@P2', '@timeout:60000'] }, async ({ Given, When, Then, And, page }) => { 
    await Given('the backend never answers GET /auth/me', null, { page }); 
    await When('I open the DevRadar web app with a stored session token for "gaearon"', null, { page }); 
    await Then('within 20 seconds I should see the message "Não foi possível falar com o servidor, tente novamente mais tarde"', null, { page }); 
    await And('I should be offered to try again or sign out, with my session kept', null, { page }); 
    await When('I try again', null, { page }); 
    await Then('I should be signed in as "gaearon"', null, { page }); 
  });

});

// == technical section ==

test.beforeEach('BeforeEach Hooks', ({ $runScenarioHooks, context }) => $runScenarioHooks('before', { context }));
test.afterEach('AfterEach Hooks', ({ $runScenarioHooks, context }) => $runScenarioHooks('after', { context }));

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('features/auth-slice4.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":13,"tags":["@smoke","@P1"],"steps":[{"pwStepLine":7,"gherkinStepLine":14,"keywordType":"Context","textWithKeyword":"Given the backend has 2 registered developers","stepMatchArguments":[{"group":{"start":16,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":8,"gherkinStepLine":15,"keywordType":"Context","textWithKeyword":"And I am signed in with GitHub as \"gaearon\"","stepMatchArguments":[{"group":{"start":30,"value":"\"gaearon\"","children":[{"start":31,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":9,"gherkinStepLine":16,"keywordType":"Outcome","textWithKeyword":"Then the developer list should show 2 entries","stepMatchArguments":[{"group":{"start":31,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":10,"gherkinStepLine":17,"keywordType":"Outcome","textWithKeyword":"And reloading the page should request the developer list with my session token","stepMatchArguments":[]}]},
  {"pwTestLine":13,"pickleLine":20,"tags":["@edge","@regression","@P1"],"steps":[{"pwStepLine":14,"gherkinStepLine":21,"keywordType":"Context","textWithKeyword":"Given the backend has 2 registered developers","stepMatchArguments":[{"group":{"start":16,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":15,"gherkinStepLine":22,"keywordType":"Context","textWithKeyword":"And the backend answers GET /devs with 401 and body '{\"error\":\"Session expired, sign in again\",\"code\":\"token_expired\",\"details\":[]}'","stepMatchArguments":[{"group":{"start":35,"value":"401"},"parameterTypeName":"int"},{"group":{"start":48,"value":"'{\"error\":\"Session expired, sign in again\",\"code\":\"token_expired\",\"details\":[]}'","children":[{"children":[{}]},{"start":49,"value":"{\"error\":\"Session expired, sign in again\",\"code\":\"token_expired\",\"details\":[]}","children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":16,"gherkinStepLine":23,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app with a stored session token for \"gaearon\"","stepMatchArguments":[{"group":{"start":60,"value":"\"gaearon\"","children":[{"start":61,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":17,"gherkinStepLine":24,"keywordType":"Outcome","textWithKeyword":"Then I should see the signed-out view","stepMatchArguments":[]},{"pwStepLine":18,"gherkinStepLine":25,"keywordType":"Outcome","textWithKeyword":"And I should see the message \"Sessão expirada, entre novamente\"","stepMatchArguments":[{"group":{"start":25,"value":"\"Sessão expirada, entre novamente\"","children":[{"start":26,"value":"Sessão expirada, entre novamente","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":19,"gherkinStepLine":26,"keywordType":"Outcome","textWithKeyword":"And the session token should be cleared","stepMatchArguments":[]}]},
  {"pwTestLine":22,"pickleLine":31,"tags":["@edge","@regression","@P2"],"steps":[{"pwStepLine":23,"gherkinStepLine":32,"keywordType":"Context","textWithKeyword":"Given I am signed in with GitHub as \"gaearon\"","stepMatchArguments":[{"group":{"start":30,"value":"\"gaearon\"","children":[{"start":31,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":24,"gherkinStepLine":33,"keywordType":"Context","textWithKeyword":"And the next GET /devs will be answered 401 \"token_expired\" after another tab signs in as \"alice\"","stepMatchArguments":[{"group":{"start":36,"value":"401"},"parameterTypeName":"int"},{"group":{"start":40,"value":"\"token_expired\"","children":[{"start":41,"value":"token_expired","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":86,"value":"\"alice\"","children":[{"start":87,"value":"alice","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":25,"gherkinStepLine":34,"keywordType":"Action","textWithKeyword":"When I reload the page","stepMatchArguments":[]},{"pwStepLine":26,"gherkinStepLine":35,"keywordType":"Outcome","textWithKeyword":"Then I should be signed in as \"alice\"","stepMatchArguments":[{"group":{"start":25,"value":"\"alice\"","children":[{"start":26,"value":"alice","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":27,"gherkinStepLine":36,"keywordType":"Outcome","textWithKeyword":"And the stored session token should belong to \"alice\"","stepMatchArguments":[{"group":{"start":42,"value":"\"alice\"","children":[{"start":43,"value":"alice","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
  {"pwTestLine":30,"pickleLine":41,"timeout":60000,"tags":["@edge","@regression","@P2","@timeout:60000"],"steps":[{"pwStepLine":31,"gherkinStepLine":42,"keywordType":"Context","textWithKeyword":"Given the backend never answers GET /auth/me","stepMatchArguments":[]},{"pwStepLine":32,"gherkinStepLine":43,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app with a stored session token for \"gaearon\"","stepMatchArguments":[{"group":{"start":60,"value":"\"gaearon\"","children":[{"start":61,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":33,"gherkinStepLine":44,"keywordType":"Outcome","textWithKeyword":"Then within 20 seconds I should see the message \"Não foi possível falar com o servidor, tente novamente mais tarde\"","stepMatchArguments":[{"group":{"start":7,"value":"20"},"parameterTypeName":"int"},{"group":{"start":43,"value":"\"Não foi possível falar com o servidor, tente novamente mais tarde\"","children":[{"start":44,"value":"Não foi possível falar com o servidor, tente novamente mais tarde","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":34,"gherkinStepLine":45,"keywordType":"Outcome","textWithKeyword":"And I should be offered to try again or sign out, with my session kept","stepMatchArguments":[]},{"pwStepLine":35,"gherkinStepLine":46,"keywordType":"Action","textWithKeyword":"When I try again","stepMatchArguments":[]},{"pwStepLine":36,"gherkinStepLine":47,"keywordType":"Outcome","textWithKeyword":"Then I should be signed in as \"gaearon\"","stepMatchArguments":[{"group":{"start":25,"value":"\"gaearon\"","children":[{"start":26,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
]; // bdd-data-end