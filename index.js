var del = require('del');
var args = require('yargs').argv;
var combine = require('stream-combiner');
var merge = require('merge-stream');
var requirejs = require('requirejs');
var $ = require('gulp-load-plugins')({lazy: true});
var utils = require('./utils');
var Server = require('karma').Server;

function MvBuilder(gulp, config) {

  /**
   * List the available gulp tasks
   */
  gulp.task('help', $.taskListing);
  gulp.task('default', ['help']);
  gulp.task('vet', ['jshint', 'jscs']);
  gulp.task('build', ['requirejs', 'revision'], function(done) {
    // Just clean up temp folder after everything is done
    return del(config.temp, done);
  });

  /**
   * Updates project rules configuration files
   */
  gulp.task('copy-rules', function() {
    utils.log('Updating rules files');
    return gulp.src(__dirname + '/configs/.js*').pipe(gulp.dest(config.root));
  });

  /**
   * Starts JSHint analysis
   */
  gulp.task('jshint', ['copy-rules'], function() {
    utils.log('Starting JSHint analysis');
    return gulp
      .src(config.allJs)
      .pipe($.jshint(config.jshintrc))
      .pipe($.jshint.reporter('jshint-stylish'))
      .pipe($.jshint.reporter('fail'));
  });

  /**
   * Starts jscs analysis
   */
  gulp.task('jscs', ['copy-rules'], function() {
    utils.log('Starting JSCS analysis');
    return gulp
      .src(config.allJs)
      .pipe($.jscs())
      .pipe($.jscs.reporter())
      .pipe($.jscs.reporter('fail'));
  });

  /* BUILDING RELATED TASKS */

  /**
   *  Usemin task - concats and minifies js and css which are in index.html
   */
  gulp.task('usemin', ['copy', 'requirejs'], function() {
    return gulp.src(config.indexHtml)
      .pipe($.usemin({
        css: [csso, autoprefixer, bless],
        js: [uglify]
      }))
      .pipe(gulp.dest(config.temp));

    function csso() {
      return $.csso();
    }

    function autoprefixer() {
      return $.autoprefixer(config.autoprefixerRules);
    }

    function bless() {
      return $.bless();
    }

    function uglify() {
      return $.uglify();
    }
  });

  /**
   * Copy task - copies all files which does not need any processing
   */
  gulp.task('copy', ['clean', 'copyDependencies'], function() {
    var stream = merge();

    /* Copy main */
    if(!args.concat) {
      stream.add(gulp.src(config.mainJs)
        .pipe(gulp.dest(config.temp + '/scripts')));
    }

    /* Copy views */
    stream.add(gulp.src(config.allViews)
      .pipe($.htmlmin({ empty: true, spare: true }))
      .pipe(gulp.dest(config.temp + '/views')));

    /* Copy favicon */
    stream.add(gulp.src(config.app + '/favicon.ico')
      .pipe(gulp.dest(config.temp)));

    /* Copy htaccess */
    stream.add(gulp.src(config.app + '/.htaccess')
      .pipe(gulp.dest(config.dist)));

    /* Copy translations */
    stream.add(gulp.src(config.app + '/translations/*')
      .pipe(gulp.dest(config.temp + '/translations')));

    /* Copy fonts */
    stream.add(gulp.src(config.app + '/fonts/*')
      .pipe(gulp.dest(config.temp + '/fonts')));

    /* Copy images */
    stream.add(gulp.src(config.allImages)
      .pipe(gulp.dest(config.temp + '/img')));

    return stream;
  });

  /**
   * Copies fonts and images from dependencies to temp folder
   */
  gulp.task('copyDependencies', ['clean'], function() {
    var stream = merge();
    stream.add(gulp.src(config.dependenciesFonts)
      .pipe(gulp.dest(config.temp + '/fonts')));

    stream.add(gulp.src(config.dependenciesImages)
      .pipe(gulp.dest(config.temp + '/img')));

    return stream;
  });

  /**
   * Clean tasks - deletes dist, temp and config template folders
   */
  gulp.task('clean', function(done) {
    return del([config.dist, config.temp, './configs/dist_template/*.js'], done);
  });

  /**
   * Copies config file if needed (when using template)
   */
  gulp.task('setConfigFile', ['usemin', 'replaceMain'], function() {
    var configUrl;

    if(args.template) {
      configUrl = config.root + 'configs/dist_template/config';
      return gulp.src([configUrl + '*.js'])
        .pipe($.rename('config.js'))
        .pipe(gulp.dest(config.temp + '/scripts'));
    }
  });

  /**
   * Requirejs task - reads main.js file and adds all libs to scrips folder
   */
  gulp.task('requirejs', ['copy'], function() {
    var configUrl, returnValue;
    var revAll = new $.revAll();

    /* available params: --dev, --prod, --staging */
    if(args.development) {
      configUrl = config.root + 'configs/development/config';
    } else if(args.template) {
      configUrl = config.root + 'configs/template/config';
    } else {
      configUrl = config.root + 'app/scripts/config';
    }

    returnValue = combine(
      gulp.src(config.mainJs),
      utils.getRequireJsConfigPaths()
    )
      .on('end', function() {
        var baseUrl = config.app + '/scripts/',
          destDir = config.temp + '/scripts/',
          libsPaths = utils.requireJsPaths,
          lib;

        if(args.concat) {

          return requirejs.optimize({
            baseUrl: baseUrl,
            paths: {
              'config': '../../' + configUrl
            },
            dir: destDir,
            uglify2: {
              mangle: false
            },
            almond: true,
            replaceRequireScript: [{
              files: [config.indexHtml],
              module: 'scripts/main'
            }],

            modules: [{name: 'main'}],

            mainConfigFile: config.mainJs,
            useStrict: true,
            optimize: 'uglify2'
          }, function() {
            return gulp.src(destDir + 'scripts/main.js')
              .pipe(gulp.dest(destDir));
          });

        } else {
          for(lib in libsPaths) {
            if( libsPaths.hasOwnProperty(lib )) {
              gulp.src(baseUrl + libsPaths[lib] + '.js')
                .pipe($.rename(lib + '.js'))
                .pipe($.uglify({ mangle: false }))
                .pipe(gulp.dest(destDir));
            }
          }
        }
      });

    /* Copy JS */
    if(!args.concat) {
      var configDest;

      if(args.template) {
        configDest = config.root + '/configs/dist_template/';
      } else {
        configDest = config.temp + '/scripts/';
      }

      gulp.src([configUrl + '.js'])
        .pipe($.uglify())
        .pipe(utils.addTimestampComment())
        .pipe(revAll.revision())
        .pipe(gulp.dest(configDest));

      return gulp.src([config.allJs, '!' + config.mainJs, '!' + config.app + '/scripts/config.js'])
        .pipe($.uglify())
        .pipe(gulp.dest(config.temp + '/scripts'));

    } else {
      return returnValue;
    }
  });

  /**
   * Revisions everything
   */
  gulp.task('revision', ['usemin', 'fix-paths', 'replaceMain', 'setConfigFile'], function() {
    var replacer = function(fragment, replaceRegExp, newReference, referencedFile){
      var regex = /^\/\('\|"\)\([a-zA-Z0-9-_\\]+\)\(\)\('\|"\|\$\)\/g$/g;
      if (!replaceRegExp.toString().match(regex)) {
        fragment.contents = fragment.contents.replace(replaceRegExp, '$1' + newReference + '$3$4');
      }
    };

    var revAll = new $.revAll({ dontRenameFile: ['index.html', 'favicon.ico'], replacer: replacer });
    return gulp.src([config.temp + '/**/*'])
      .pipe(revAll.revision())
      .pipe(gulp.dest(config.dist));
  });

  /**
   * Replaces lib paths in main.js file
   */
  gulp.task('replaceMain', ['usemin'], function() {
    return gulp.src([config.temp + '/scripts/main.js'])
      .pipe(utils.replaceRequireJsConfigPaths())
      .pipe($.uglify())
      .pipe(gulp.dest(config.temp + '/scripts'));
  });

  /**
   * Fixes paths for resources from dependencies
   */
  gulp.task('fix-paths', ['usemin'], function() {
    return gulp.src(config.temp + '/styles/**/*')
      .pipe($.replace('../../img', '../img'))
      .pipe($.replace('../../fonts', '../fonts'))
      .pipe(gulp.dest(config.temp + '/styles'));
  });

  /**
   * Checks if there missing translation files
   */
  gulp.task('translations', function() {
    return gulp.src(config.sniffForTranslations)
      .pipe($.missingTranslations({ translationsSrc: config.translationFiles }));
  });

  /**
   * Cleans sass files
   **/
  gulp.task('clean-styles-sass', function (done) {
    utils.log('Cleaning SASS styles');
    return del(config.sassDest + '/**/*', done);
  });

  /**
   * Compiles SASS source files to css files
   */
  gulp.task('compile-sass', ['clean-styles-sass'], function () {
    utils.log('Compiling SASS --> CSS');

    return gulp
      .src(config.sassSrc)
      .pipe($.sass({
        includePaths: [config.compassMixins],
        outputStyle: 'expanded',
        errLogToConsole: true
      }))
      .pipe(gulp.dest(config.sassDest));
  });

  /**
   * Watches for SASS files changes and triggers compilation
   */
  gulp.task('watch-sass', function(){
    gulp.watch([config.sassSrc], ['compile-sass']);
  });

  /**
   * Cleans less files
   **/
  gulp.task('clean-styles-less', function (done) {
    utils.log('Cleaning LESS styles');
    return del([config.lessDest + '/**/*'], done);
  });

  /**
   * Compiles LESS source files to css files
   */
  gulp.task('compile-less', ['clean-styles-less'], function () {
    var filter = $.filter(utils.isNotPrivate);
    utils.log('Compiling LESS --> CSS');

    return gulp
      .src(config.lessSrc)
      .pipe($.plumber({
        errorHandler: function (err) {
          console.log(err);
          this.emit('end');
        }
      }))
      .pipe($.less())
      .pipe($.autoprefixer({ browsers: config.browserslist }))
      .pipe(filter)
      .pipe(gulp.dest(config.lessDest));
  });

  /**
   * Watches for LESS files changes and triggers compilation
   */
  gulp.task('watch-less', function(){
    gulp.watch([config.lessSrc], ['compile-less']);
  });

  /* Karma task - starts unit tests */
  gulp.task('karma', function(done) {
    var server = new Server({
      configFile: config.root + 'karma.conf.js',
      singleRun: true
    });

    server.on('run_complete', function (browsers, results) {
      // NB If the argument of done() is not null or not undefined, e.g. a string, the next task in a series won't run.
      done(results.error ? 'There are test failures' : null);
    });

    server.start();
  });
}

module.exports = MvBuilder;