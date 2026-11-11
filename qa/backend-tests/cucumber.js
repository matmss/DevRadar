module.exports = {
  default: {
    requireModule: [],
    require: ['features/support/**/*.js', 'features/step_definitions/**/*.js'],
    format: ['progress-bar', 'html:../reports/backend-report.html'],
    publishQuiet: true,
    // Exit once the run and its AfterAll hooks are done, even if a timed-out step left a handle
    // open (a supertest server, a socket). Without it a run could print its summary and hang.
    forceExit: true,
    paths: ['features/**/*.feature']
  }
};
