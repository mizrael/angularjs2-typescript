const gulp = require('gulp'),
    del = require('del'),
    ts = require('gulp-typescript'),
    sourcemaps = require('gulp-sourcemaps'),
    webserver = require('gulp-webserver'),
    webroot = "www",
    paths = {
        www: webroot + "/",
        wwwLibs: webroot + "/libs/",
        jsOutput: webroot + "/app/",
        modules: 'node_modules/',
        tsSource: 'src/**/*.ts'
    },
    tsProject = ts.createProject('tsconfig.json');

gulp.task('clean', function () {
    del([
        paths.www + 'app/**/*.js',
        paths.www + 'app/**/*.map',
        paths.www + 'assets/**/*.js'
    ]);
});

gulp.task('libs', function () {
    const libs = {
            'system' : 'systemjs/**/*.js',
            'angular2' : 'angular2/**/*.js',
            'rxjs' : 'rxjs/**/*.js'
        };

    for (var destinationDir in libs) {
        gulp.src(paths.modules + libs[destinationDir])
          .pipe(gulp.dest(paths.wwwLibs + destinationDir));
    }
});

gulp.task('build', ['clean', 'libs'], function () {
    var tsResult = tsProject.src(paths.tsSource)
                    .pipe(sourcemaps.init())
                    .pipe(ts(tsProject));
	
	return tsResult.js
				.pipe(sourcemaps.write('maps'))
				.pipe(gulp.dest('www/app'));
});

gulp.task('default', [ 'build' ], function () {
    gulp.src('www')
        .pipe(webserver({
            livereload: false,
            port: 8000,
            open: true
        }));
    return gulp.watch(paths.tsSource, ['build']);
});