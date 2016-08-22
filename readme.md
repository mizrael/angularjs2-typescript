# Introduction
This repo will serve as a template for a basic AngularJS 2 project written in Typescript.
Gulp is configured to watch the .ts files and transpile them if a change occurs. 
At the end of the first build, a simple webserver is created, pointing ad the /www/ folder.
 
# Prerequisites
* execute the following commands:
```
sudo npm install -g typescript
sudo npm install -g typings
sudo npm install -g gulp
```

# Initialization
* create project folder and enter it
* execute the following commands:

```
tsc --init --target es5 --sourceMap --experimentalDecorators --emitDecoratorMetadata
typings install dt~es6-shim --global --save
```

* Add typings.json file to the project folder with the following content:

```
{ 
    "ambientDependencies": 
    { 
        "es6-shim": "github:DefinitelyTyped/DefinitelyTyped/es6-shim/es6-shim.d.ts#6697d6f7dadbf5773cb40ecda35a76027e0783b2" 
    }
}
```

* execute the following commands:

```
npm init
npm install angular2 --save
npm install systemjs --save
npm install typings --save-dev
npm install gulp --save --save-dev
npm install del --save-dev
npm install gulp-typescript --save-dev
npm install gulp-concat --save-dev
npm install gulp-webserver --save-dev
npm install gulp-sourcemaps --save-dev
sudo typings install
```

* edit the package.json file and set gulpfile.js as "main"

```
"main": "gulpfile.js":
```

# Run the build task
in Visual Studio Code (on Mac): cmd + shift + b