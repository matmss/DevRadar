// Generated from: features/registration.feature
import { test } from "playwright-bdd";

test.describe('Register a developer from the web app', () => {

  test('Browser geolocation pre-fills the coordinates', { tag: ['@smoke', '@P2'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"', null, { context }); 
    await And('the backend has no registered developers'); 
    await When('I open the DevRadar web app', null, { page }); 
    await Then('the latitude field should contain "-23.5505"', null, { page }); 
    await And('the longitude field should contain "-46.6333"', null, { page }); 
  });

  test('Submitting the form adds the developer to the visible list without a page reload', { tag: ['@smoke', '@P1'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"', null, { context }); 
    await And('the backend has no registered developers'); 
    await When('I open the DevRadar web app', null, { page }); 
    await And('I fill in github username "gaearon", techs "ReactJS,Redux" and submit', null, { page }); 
    await Then('a new entry for "gaearon" should appear in the developer list', null, { page }); 
    await And('the github username field should be empty', null, { page }); 
    await And('the techs field should be empty', null, { page }); 
  });

  test('Geolocation permission denied still allows manual entry', { tag: ['@edge', '@P2'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the browser denies geolocation permission', null, { context }); 
    await And('the backend has no registered developers'); 
    await When('I open the DevRadar web app', null, { page }); 
    await And('I manually fill in latitude "-23.5505" and longitude "-46.6333"', null, { page }); 
    await And('I fill in github username "gaearon", techs "ReactJS" and submit', null, { page }); 
    await Then('a new entry for "gaearon" should appear in the developer list', null, { page }); 
  });

  test('Developer list loads existing developers on page load', { tag: ['@regression', '@P2'] }, async ({ Given, When, Then, page }) => { 
    await Given('the backend has 2 registered developers'); 
    await When('I open the DevRadar web app', null, { page }); 
    await Then('the developer list should show 2 entries', null, { page }); 
  });

  test('A registered developer survives a page reload', { tag: ['@regression', '@P2'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"', null, { context }); 
    await And('the backend has no registered developers'); 
    await When('I open the DevRadar web app', null, { page }); 
    await And('I fill in github username "gaearon", techs "ReactJS,Redux" and submit', null, { page }); 
    await Then('reloading the page should still show "gaearon" in the developer list', null, { page }); 
  });

  test('A rejected registration shows the server\'s error and keeps the input', { tag: ['@edge', '@regression', '@P1'] }, async ({ Given, When, Then, And, context, page }) => { 
    await Given('the browser grants geolocation permission at latitude "-23.5505" and longitude "-46.6333"', null, { context }); 
    await And('the backend has no registered developers'); 
    await When('I open the DevRadar web app', null, { page }); 
    await And('I fill in github username "-bad-name-", techs "ReactJS" and submit', null, { page }); 
    await Then('I should see the error "github_username is not a valid GitHub username"', null, { page }); 
    await And('the github username field should contain "-bad-name-"', null, { page }); 
    await And('the developer list should show 0 entries', null, { page }); 
  });

});

// == technical section ==

test.use({
  $test: [({}, use) => use(test), { scope: 'test', box: true }],
  $uri: [({}, use) => use('features/registration.feature'), { scope: 'test', box: true }],
  $bddFileData: [({}, use) => use(bddFileData), { scope: "test", box: true }],
});

const bddFileData = [ // bdd-data-start
  {"pwTestLine":6,"pickleLine":7,"tags":["@smoke","@P2"],"steps":[{"pwStepLine":7,"gherkinStepLine":8,"keywordType":"Context","textWithKeyword":"Given the browser grants geolocation permission at latitude \"-23.5505\" and longitude \"-46.6333\"","stepMatchArguments":[{"group":{"start":54,"value":"\"-23.5505\"","children":[{"start":55,"value":"-23.5505","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":79,"value":"\"-46.6333\"","children":[{"start":80,"value":"-46.6333","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":8,"gherkinStepLine":9,"keywordType":"Context","textWithKeyword":"And the backend has no registered developers","stepMatchArguments":[]},{"pwStepLine":9,"gherkinStepLine":10,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":10,"gherkinStepLine":11,"keywordType":"Outcome","textWithKeyword":"Then the latitude field should contain \"-23.5505\"","stepMatchArguments":[{"group":{"start":34,"value":"\"-23.5505\"","children":[{"start":35,"value":"-23.5505","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":11,"gherkinStepLine":12,"keywordType":"Outcome","textWithKeyword":"And the longitude field should contain \"-46.6333\"","stepMatchArguments":[{"group":{"start":35,"value":"\"-46.6333\"","children":[{"start":36,"value":"-46.6333","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
  {"pwTestLine":14,"pickleLine":15,"tags":["@smoke","@P1"],"steps":[{"pwStepLine":15,"gherkinStepLine":16,"keywordType":"Context","textWithKeyword":"Given the browser grants geolocation permission at latitude \"-23.5505\" and longitude \"-46.6333\"","stepMatchArguments":[{"group":{"start":54,"value":"\"-23.5505\"","children":[{"start":55,"value":"-23.5505","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":79,"value":"\"-46.6333\"","children":[{"start":80,"value":"-46.6333","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":16,"gherkinStepLine":17,"keywordType":"Context","textWithKeyword":"And the backend has no registered developers","stepMatchArguments":[]},{"pwStepLine":17,"gherkinStepLine":18,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":18,"gherkinStepLine":19,"keywordType":"Action","textWithKeyword":"And I fill in github username \"gaearon\", techs \"ReactJS,Redux\" and submit","stepMatchArguments":[{"group":{"start":26,"value":"\"gaearon\"","children":[{"start":27,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":43,"value":"\"ReactJS,Redux\"","children":[{"start":44,"value":"ReactJS,Redux","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":19,"gherkinStepLine":20,"keywordType":"Outcome","textWithKeyword":"Then a new entry for \"gaearon\" should appear in the developer list","stepMatchArguments":[{"group":{"start":16,"value":"\"gaearon\"","children":[{"start":17,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":20,"gherkinStepLine":21,"keywordType":"Outcome","textWithKeyword":"And the github username field should be empty","stepMatchArguments":[]},{"pwStepLine":21,"gherkinStepLine":22,"keywordType":"Outcome","textWithKeyword":"And the techs field should be empty","stepMatchArguments":[]}]},
  {"pwTestLine":24,"pickleLine":25,"tags":["@edge","@P2"],"steps":[{"pwStepLine":25,"gherkinStepLine":26,"keywordType":"Context","textWithKeyword":"Given the browser denies geolocation permission","stepMatchArguments":[]},{"pwStepLine":26,"gherkinStepLine":27,"keywordType":"Context","textWithKeyword":"And the backend has no registered developers","stepMatchArguments":[]},{"pwStepLine":27,"gherkinStepLine":28,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":28,"gherkinStepLine":29,"keywordType":"Action","textWithKeyword":"And I manually fill in latitude \"-23.5505\" and longitude \"-46.6333\"","stepMatchArguments":[{"group":{"start":28,"value":"\"-23.5505\"","children":[{"start":29,"value":"-23.5505","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":53,"value":"\"-46.6333\"","children":[{"start":54,"value":"-46.6333","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":29,"gherkinStepLine":30,"keywordType":"Action","textWithKeyword":"And I fill in github username \"gaearon\", techs \"ReactJS\" and submit","stepMatchArguments":[{"group":{"start":26,"value":"\"gaearon\"","children":[{"start":27,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":43,"value":"\"ReactJS\"","children":[{"start":44,"value":"ReactJS","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":30,"gherkinStepLine":31,"keywordType":"Outcome","textWithKeyword":"Then a new entry for \"gaearon\" should appear in the developer list","stepMatchArguments":[{"group":{"start":16,"value":"\"gaearon\"","children":[{"start":17,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
  {"pwTestLine":33,"pickleLine":34,"tags":["@regression","@P2"],"steps":[{"pwStepLine":34,"gherkinStepLine":35,"keywordType":"Context","textWithKeyword":"Given the backend has 2 registered developers","stepMatchArguments":[{"group":{"start":16,"value":"2"},"parameterTypeName":"int"}]},{"pwStepLine":35,"gherkinStepLine":36,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":36,"gherkinStepLine":37,"keywordType":"Outcome","textWithKeyword":"Then the developer list should show 2 entries","stepMatchArguments":[{"group":{"start":31,"value":"2"},"parameterTypeName":"int"}]}]},
  {"pwTestLine":39,"pickleLine":40,"tags":["@regression","@P2"],"steps":[{"pwStepLine":40,"gherkinStepLine":41,"keywordType":"Context","textWithKeyword":"Given the browser grants geolocation permission at latitude \"-23.5505\" and longitude \"-46.6333\"","stepMatchArguments":[{"group":{"start":54,"value":"\"-23.5505\"","children":[{"start":55,"value":"-23.5505","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":79,"value":"\"-46.6333\"","children":[{"start":80,"value":"-46.6333","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":41,"gherkinStepLine":42,"keywordType":"Context","textWithKeyword":"And the backend has no registered developers","stepMatchArguments":[]},{"pwStepLine":42,"gherkinStepLine":43,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":43,"gherkinStepLine":44,"keywordType":"Action","textWithKeyword":"And I fill in github username \"gaearon\", techs \"ReactJS,Redux\" and submit","stepMatchArguments":[{"group":{"start":26,"value":"\"gaearon\"","children":[{"start":27,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":43,"value":"\"ReactJS,Redux\"","children":[{"start":44,"value":"ReactJS,Redux","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":44,"gherkinStepLine":45,"keywordType":"Outcome","textWithKeyword":"Then reloading the page should still show \"gaearon\" in the developer list","stepMatchArguments":[{"group":{"start":37,"value":"\"gaearon\"","children":[{"start":38,"value":"gaearon","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]}]},
  {"pwTestLine":47,"pickleLine":48,"tags":["@edge","@regression","@P1"],"steps":[{"pwStepLine":48,"gherkinStepLine":49,"keywordType":"Context","textWithKeyword":"Given the browser grants geolocation permission at latitude \"-23.5505\" and longitude \"-46.6333\"","stepMatchArguments":[{"group":{"start":54,"value":"\"-23.5505\"","children":[{"start":55,"value":"-23.5505","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":79,"value":"\"-46.6333\"","children":[{"start":80,"value":"-46.6333","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":49,"gherkinStepLine":50,"keywordType":"Context","textWithKeyword":"And the backend has no registered developers","stepMatchArguments":[]},{"pwStepLine":50,"gherkinStepLine":51,"keywordType":"Action","textWithKeyword":"When I open the DevRadar web app","stepMatchArguments":[]},{"pwStepLine":51,"gherkinStepLine":52,"keywordType":"Action","textWithKeyword":"And I fill in github username \"-bad-name-\", techs \"ReactJS\" and submit","stepMatchArguments":[{"group":{"start":26,"value":"\"-bad-name-\"","children":[{"start":27,"value":"-bad-name-","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"},{"group":{"start":46,"value":"\"ReactJS\"","children":[{"start":47,"value":"ReactJS","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":52,"gherkinStepLine":53,"keywordType":"Outcome","textWithKeyword":"Then I should see the error \"github_username is not a valid GitHub username\"","stepMatchArguments":[{"group":{"start":23,"value":"\"github_username is not a valid GitHub username\"","children":[{"start":24,"value":"github_username is not a valid GitHub username","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":53,"gherkinStepLine":54,"keywordType":"Outcome","textWithKeyword":"And the github username field should contain \"-bad-name-\"","stepMatchArguments":[{"group":{"start":41,"value":"\"-bad-name-\"","children":[{"start":42,"value":"-bad-name-","children":[{}]},{"children":[{}]}]},"parameterTypeName":"string"}]},{"pwStepLine":54,"gherkinStepLine":55,"keywordType":"Outcome","textWithKeyword":"And the developer list should show 0 entries","stepMatchArguments":[{"group":{"start":31,"value":"0"},"parameterTypeName":"int"}]}]},
]; // bdd-data-end