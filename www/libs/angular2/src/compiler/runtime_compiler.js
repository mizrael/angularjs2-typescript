'use strict';"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var lang_1 = require('angular2/src/facade/lang');
var exceptions_1 = require('angular2/src/facade/exceptions');
var collection_1 = require('angular2/src/facade/collection');
var async_1 = require('angular2/src/facade/async');
var compile_metadata_1 = require('./compile_metadata');
var di_1 = require('angular2/src/core/di');
var style_compiler_1 = require('./style_compiler');
var view_compiler_1 = require('./view_compiler/view_compiler');
var template_parser_1 = require('./template_parser');
var directive_normalizer_1 = require('./directive_normalizer');
var runtime_metadata_1 = require('./runtime_metadata');
var component_factory_1 = require('angular2/src/core/linker/component_factory');
var config_1 = require('./config');
var ir = require('./output/output_ast');
var output_jit_1 = require('./output/output_jit');
var output_interpreter_1 = require('./output/output_interpreter');
var interpretive_view_1 = require('./output/interpretive_view');
var xhr_1 = require('angular2/src/compiler/xhr');
/**
 * An internal module of the Angular compiler that begins with component types,
 * extracts templates, and eventually produces a compiled version of the component
 * ready for linking into an application.
 */
var RuntimeCompiler = (function () {
    function RuntimeCompiler(_runtimeMetadataResolver, _templateNormalizer, _templateParser, _styleCompiler, _viewCompiler, _xhr, _genConfig) {
        this._runtimeMetadataResolver = _runtimeMetadataResolver;
        this._templateNormalizer = _templateNormalizer;
        this._templateParser = _templateParser;
        this._styleCompiler = _styleCompiler;
        this._viewCompiler = _viewCompiler;
        this._xhr = _xhr;
        this._genConfig = _genConfig;
        this._styleCache = new Map();
        this._hostCacheKeys = new Map();
        this._compiledTemplateCache = new Map();
        this._compiledTemplateDone = new Map();
    }
    RuntimeCompiler.prototype.resolveComponent = function (componentType) {
        var compMeta = this._runtimeMetadataResolver.getDirectiveMetadata(componentType);
        var hostCacheKey = this._hostCacheKeys.get(componentType);
        if (lang_1.isBlank(hostCacheKey)) {
            hostCacheKey = new Object();
            this._hostCacheKeys.set(componentType, hostCacheKey);
            assertComponent(compMeta);
            var hostMeta = compile_metadata_1.createHostComponentMeta(compMeta.type, compMeta.selector);
            this._loadAndCompileComponent(hostCacheKey, hostMeta, [compMeta], [], []);
        }
        return this._compiledTemplateDone.get(hostCacheKey)
            .then(function (compiledTemplate) { return new component_factory_1.ComponentFactory(compMeta.selector, compiledTemplate.viewFactory, componentType); });
    };
    RuntimeCompiler.prototype.clearCache = function () {
        this._styleCache.clear();
        this._compiledTemplateCache.clear();
        this._compiledTemplateDone.clear();
        this._hostCacheKeys.clear();
    };
    RuntimeCompiler.prototype._loadAndCompileComponent = function (cacheKey, compMeta, viewDirectives, pipes, compilingComponentsPath) {
        var _this = this;
        var compiledTemplate = this._compiledTemplateCache.get(cacheKey);
        var done = this._compiledTemplateDone.get(cacheKey);
        if (lang_1.isBlank(compiledTemplate)) {
            compiledTemplate = new CompiledTemplate();
            this._compiledTemplateCache.set(cacheKey, compiledTemplate);
            done =
                async_1.PromiseWrapper.all([this._compileComponentStyles(compMeta)].concat(viewDirectives.map(function (dirMeta) { return _this._templateNormalizer.normalizeDirective(dirMeta); })))
                    .then(function (stylesAndNormalizedViewDirMetas) {
                    var normalizedViewDirMetas = stylesAndNormalizedViewDirMetas.slice(1);
                    var styles = stylesAndNormalizedViewDirMetas[0];
                    var parsedTemplate = _this._templateParser.parse(compMeta, compMeta.template.template, normalizedViewDirMetas, pipes, compMeta.type.name);
                    var childPromises = [];
                    compiledTemplate.init(_this._compileComponent(compMeta, parsedTemplate, styles, pipes, compilingComponentsPath, childPromises));
                    return async_1.PromiseWrapper.all(childPromises).then(function (_) { return compiledTemplate; });
                });
            this._compiledTemplateDone.set(cacheKey, done);
        }
        return compiledTemplate;
    };
    RuntimeCompiler.prototype._compileComponent = function (compMeta, parsedTemplate, styles, pipes, compilingComponentsPath, childPromises) {
        var _this = this;
        var compileResult = this._viewCompiler.compileComponent(compMeta, parsedTemplate, new ir.ExternalExpr(new compile_metadata_1.CompileIdentifierMetadata({ runtime: styles })), pipes);
        compileResult.dependencies.forEach(function (dep) {
            var childCompilingComponentsPath = collection_1.ListWrapper.clone(compilingComponentsPath);
            var childCacheKey = dep.comp.type.runtime;
            var childViewDirectives = _this._runtimeMetadataResolver.getViewDirectivesMetadata(dep.comp.type.runtime);
            var childViewPipes = _this._runtimeMetadataResolver.getViewPipesMetadata(dep.comp.type.runtime);
            var childIsRecursive = collection_1.ListWrapper.contains(childCompilingComponentsPath, childCacheKey);
            childCompilingComponentsPath.push(childCacheKey);
            var childComp = _this._loadAndCompileComponent(dep.comp.type.runtime, dep.comp, childViewDirectives, childViewPipes, childCompilingComponentsPath);
            dep.factoryPlaceholder.runtime = childComp.proxyViewFactory;
            dep.factoryPlaceholder.name = "viewFactory_" + dep.comp.type.name;
            if (!childIsRecursive) {
                // Only wait for a child if it is not a cycle
                childPromises.push(_this._compiledTemplateDone.get(childCacheKey));
            }
        });
        var factory;
        if (lang_1.IS_DART || !this._genConfig.useJit) {
            factory = output_interpreter_1.interpretStatements(compileResult.statements, compileResult.viewFactoryVar, new interpretive_view_1.InterpretiveAppViewInstanceFactory());
        }
        else {
            factory = output_jit_1.jitStatements(compMeta.type.name + ".template.js", compileResult.statements, compileResult.viewFactoryVar);
        }
        return factory;
    };
    RuntimeCompiler.prototype._compileComponentStyles = function (compMeta) {
        var compileResult = this._styleCompiler.compileComponent(compMeta);
        return this._resolveStylesCompileResult(compMeta.type.name, compileResult);
    };
    RuntimeCompiler.prototype._resolveStylesCompileResult = function (sourceUrl, result) {
        var _this = this;
        var promises = result.dependencies.map(function (dep) { return _this._loadStylesheetDep(dep); });
        return async_1.PromiseWrapper.all(promises)
            .then(function (cssTexts) {
            var nestedCompileResultPromises = [];
            for (var i = 0; i < result.dependencies.length; i++) {
                var dep = result.dependencies[i];
                var cssText = cssTexts[i];
                var nestedCompileResult = _this._styleCompiler.compileStylesheet(dep.sourceUrl, cssText, dep.isShimmed);
                nestedCompileResultPromises.push(_this._resolveStylesCompileResult(dep.sourceUrl, nestedCompileResult));
            }
            return async_1.PromiseWrapper.all(nestedCompileResultPromises);
        })
            .then(function (nestedStylesArr) {
            for (var i = 0; i < result.dependencies.length; i++) {
                var dep = result.dependencies[i];
                dep.valuePlaceholder.runtime = nestedStylesArr[i];
                dep.valuePlaceholder.name = "importedStyles" + i;
            }
            if (lang_1.IS_DART || !_this._genConfig.useJit) {
                return output_interpreter_1.interpretStatements(result.statements, result.stylesVar, new interpretive_view_1.InterpretiveAppViewInstanceFactory());
            }
            else {
                return output_jit_1.jitStatements(sourceUrl + ".css.js", result.statements, result.stylesVar);
            }
        });
    };
    RuntimeCompiler.prototype._loadStylesheetDep = function (dep) {
        var cacheKey = "" + dep.sourceUrl + (dep.isShimmed ? '.shim' : '');
        var cssTextPromise = this._styleCache.get(cacheKey);
        if (lang_1.isBlank(cssTextPromise)) {
            cssTextPromise = this._xhr.get(dep.sourceUrl);
            this._styleCache.set(cacheKey, cssTextPromise);
        }
        return cssTextPromise;
    };
    RuntimeCompiler = __decorate([
        di_1.Injectable(), 
        __metadata('design:paramtypes', [runtime_metadata_1.RuntimeMetadataResolver, directive_normalizer_1.DirectiveNormalizer, template_parser_1.TemplateParser, style_compiler_1.StyleCompiler, view_compiler_1.ViewCompiler, xhr_1.XHR, config_1.CompilerConfig])
    ], RuntimeCompiler);
    return RuntimeCompiler;
}());
exports.RuntimeCompiler = RuntimeCompiler;
var CompiledTemplate = (function () {
    function CompiledTemplate() {
        var _this = this;
        this.viewFactory = null;
        this.proxyViewFactory = function (viewUtils, childInjector, contextEl) {
            return _this.viewFactory(viewUtils, childInjector, contextEl);
        };
    }
    CompiledTemplate.prototype.init = function (viewFactory) { this.viewFactory = viewFactory; };
    return CompiledTemplate;
}());
function assertComponent(meta) {
    if (!meta.isComponent) {
        throw new exceptions_1.BaseException("Could not compile '" + meta.type.name + "' because it is not a component.");
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVudGltZV9jb21waWxlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRpZmZpbmdfcGx1Z2luX3dyYXBwZXItb3V0cHV0X3BhdGgtQlJKZXIxSjkudG1wL2FuZ3VsYXIyL3NyYy9jb21waWxlci9ydW50aW1lX2NvbXBpbGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7QUFBQSxxQkFRTywwQkFBMEIsQ0FBQyxDQUFBO0FBQ2xDLDJCQUE0QixnQ0FBZ0MsQ0FBQyxDQUFBO0FBQzdELDJCQUtPLGdDQUFnQyxDQUFDLENBQUE7QUFDeEMsc0JBQTZCLDJCQUEyQixDQUFDLENBQUE7QUFDekQsaUNBUU8sb0JBQW9CLENBQUMsQ0FBQTtBQWdCNUIsbUJBQXlCLHNCQUFzQixDQUFDLENBQUE7QUFDaEQsK0JBQTBFLGtCQUFrQixDQUFDLENBQUE7QUFDN0YsOEJBQTJCLCtCQUErQixDQUFDLENBQUE7QUFDM0QsZ0NBQTZCLG1CQUFtQixDQUFDLENBQUE7QUFDakQscUNBQWtDLHdCQUF3QixDQUFDLENBQUE7QUFDM0QsaUNBQXNDLG9CQUFvQixDQUFDLENBQUE7QUFDM0Qsa0NBQStCLDRDQUE0QyxDQUFDLENBQUE7QUFNNUUsdUJBQTZCLFVBQVUsQ0FBQyxDQUFBO0FBQ3hDLElBQVksRUFBRSxXQUFNLHFCQUFxQixDQUFDLENBQUE7QUFDMUMsMkJBQTRCLHFCQUFxQixDQUFDLENBQUE7QUFDbEQsbUNBQWtDLDZCQUE2QixDQUFDLENBQUE7QUFDaEUsa0NBQWlELDRCQUE0QixDQUFDLENBQUE7QUFFOUUsb0JBQWtCLDJCQUEyQixDQUFDLENBQUE7QUFFOUM7Ozs7R0FJRztBQUVIO0lBTUUseUJBQW9CLHdCQUFpRCxFQUNqRCxtQkFBd0MsRUFDeEMsZUFBK0IsRUFBVSxjQUE2QixFQUN0RSxhQUEyQixFQUFVLElBQVMsRUFDOUMsVUFBMEI7UUFKMUIsNkJBQXdCLEdBQXhCLHdCQUF3QixDQUF5QjtRQUNqRCx3QkFBbUIsR0FBbkIsbUJB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QUFDO1FBRzNCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxVQUFDLFNBQVMsRUFBRSxhQUFhLEVBQUUsU0FBUztZQUN4RCxPQUFBLEtBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLGFBQWEsRUFBRSxTQUFTLENBQUM7UUFBckQsQ0FBcUQsQ0FBQztJQUM1RCxDQUFDO0lBRUQsK0JBQUksR0FBSixVQUFLLFdBQXFCLElBQUksSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUMsQ0FBQyxDQUFDO0lBQ2pFLHVCQUFDO0FBQUQsQ0FBQyxBQVRELElBU0M7QUFFRCx5QkFBeUIsSUFBOEI7SUFDckQsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQztRQUN0QixNQUFNLElBQUksMEJBQWEsQ0FBQyx3QkFBc0IsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLHFDQUFrQyxDQUFDLENBQUM7SUFDbEcsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBJU19EQVJULFxuICBUeXBlLFxuICBKc29uLFxuICBpc0JsYW5rLFxuICBpc1ByZXNlbnQsXG4gIHN0cmluZ2lmeSxcbiAgZXZhbEV4cHJlc3Npb25cbn0gZnJvbSAnYW5ndWxhcjIvc3JjL2ZhY2FkZS9sYW5nJztcbmltcG9ydCB7QmFzZUV4Y2VwdGlvbn0gZnJvbSAnYW5ndWxhcjIvc3JjL2ZhY2FkZS9leGNlcHRpb25zJztcbmltcG9ydCB7XG4gIExpc3RXcmFwcGVyLFxuICBTZXRXcmFwcGVyLFxuICBNYXBXcmFwcGVyLFxuICBTdHJpbmdNYXBXcmFwcGVyXG59IGZyb20gJ2FuZ3VsYXIyL3NyYy9mYWNhZGUvY29sbGVjdGlvbic7XG5pbXBvcnQge1Byb21pc2VXcmFwcGVyfSBmcm9tICdhbmd1bGFyMi9zcmMvZmFjYWRlL2FzeW5jJztcbmltcG9ydCB7XG4gIGNyZWF0ZUhvc3RDb21wb25lbnRNZXRhLFxuICBDb21waWxlRGlyZWN0aXZlTWV0YWRhdGEsXG4gIENvbXBpbGVUeXBlTWV0YWRhdGEsXG4gIENvbXBpbGVUZW1wbGF0ZU1ldGFkYXRhLFxuICBDb21waWxlUGlwZU1ldGFkYXRhLFxuICBDb21waWxlTWV0YWRhdGFXaXRoVHlwZSxcbiAgQ29tcGlsZUlkZW50aWZpZXJNZXRhZGF0YVxufSBmcm9tICcuL2NvbXBpbGVfbWV0YWRhdGEnO1xuaW1wb3J0IHtcbiAgVGVtcGxhdGVBc3QsXG4gIFRlbXBsYXRlQXN0VmlzaXRvcixcbiAgTmdDb250ZW50QXN0LFxuICBFbWJlZGRlZFRlbXBsYXRlQXN0LFxuICBFbGVtZW50QXN0LFxuICBCb3VuZEV2ZW50QXN0LFxuICBCb3VuZEVsZW1lbnRQcm9wZXJ0eUFzdCxcbiAgQXR0ckFzdCxcbiAgQm91bmRUZXh0QXN0LFxuICBUZXh0QXN0LFxuICBEaXJlY3RpdmVBc3QsXG4gIEJvdW5kRGlyZWN0aXZlUHJvcGVydHlBc3QsXG4gIHRlbXBsYXRlVmlzaXRBbGxcbn0gZnJvbSAnLi90ZW1wbGF0ZV9hc3QnO1xuaW1wb3J0IHtJbmplY3RhYmxlfSBmcm9tICdhbmd1bGFyMi9zcmMvY29yZS9kaSc7XG5pbXBvcnQge1N0eWxlQ29tcGlsZXIsIFN0eWxlc0NvbXBpbGVEZXBlbmRlbmN5LCBTdHlsZXNDb21waWxlUmVzdWx0fSBmcm9tICcuL3N0eWxlX2NvbXBpbGVyJztcbmltcG9ydCB7Vmlld0NvbXBpbGVyfSBmcm9tICcuL3ZpZXdfY29tcGlsZXIvdmlld19jb21waWxlcic7XG5pbXBvcnQge1RlbXBsYXRlUGFyc2VyfSBmcm9tICcuL3RlbXBsYXRlX3BhcnNlcic7XG5pbXBvcnQge0RpcmVjdGl2ZU5vcm1hbGl6ZXJ9IGZyb20gJy4vZGlyZWN0aXZlX25vcm1hbGl6ZXInO1xuaW1wb3J0IHtSdW50aW1lTWV0YWRhdGFSZXNvbHZlcn0gZnJvbSAnLi9ydW50aW1lX21ldGFkYXRhJztcbmltcG9ydCB7Q29tcG9uZW50RmFjdG9yeX0gZnJvbSAnYW5ndWxhcjIvc3JjL2NvcmUvbGlua2VyL2NvbXBvbmVudF9mYWN0b3J5JztcbmltcG9ydCB7XG4gIENvbXBvbmVudFJlc29sdmVyLFxuICBSZWZsZWN0b3JDb21wb25lbnRSZXNvbHZlclxufSBmcm9tICdhbmd1bGFyMi9zcmMvY29yZS9saW5rZXIvY29tcG9uZW50X3Jlc29sdmVyJztcblxuaW1wb3J0IHtDb21waWxlckNvbmZpZ30gZnJvbSAnLi9jb25maWcnO1xuaW1wb3J0ICogYXMgaXIgZnJvbSAnLi9vdXRwdXQvb3V0cHV0X2FzdCc7XG5pbXBvcnQge2ppdFN0YXRlbWVudHN9IGZyb20gJy4vb3V0cHV0L291dHB1dF9qaXQnO1xuaW1wb3J0IHtpbnRlcnByZXRTdGF0ZW1lbnRzfSBmcm9tICcuL291dHB1dC9vdXRwdXRfaW50ZXJwcmV0ZXInO1xuaW1wb3J0IHtJbnRlcnByZXRpdmVBcHBWaWV3SW5zdGFuY2VGYWN0b3J5fSBmcm9tICcuL291dHB1dC9pbnRlcnByZXRpdmVfdmlldyc7XG5cbmltcG9ydCB7WEhSfSBmcm9tICdhbmd1bGFyMi9zcmMvY29tcGlsZXIveGhyJztcblxuLyoqXG4gKiBBbiBpbnRlcm5hbCBtb2R1bGUgb2YgdGhlIEFuZ3VsYXIgY29tcGlsZXIgdGhhdCBiZWdpbnMgd2l0aCBjb21wb25lbnQgdHlwZXMsXG4gKiBleHRyYWN0cyB0ZW1wbGF0ZXMsIGFuZCBldmVudHVhbGx5IHByb2R1Y2VzIGEgY29tcGlsZWQgdmVyc2lvbiBvZiB0aGUgY29tcG9uZW50XG4gKiByZWFkeSBmb3IgbGlua2luZyBpbnRvIGFuIGFwcGxpY2F0aW9uLlxuICovXG5ASW5qZWN0YWJsZSgpXG5leHBvcnQgY2xhc3MgUnVudGltZUNvbXBpbGVyIGltcGxlbWVudHMgQ29tcG9uZW50UmVzb2x2ZXIge1xuICBwcml2YXRlIF9zdHlsZUNhY2hlOiBNYXA8c3RyaW5nLCBQcm9taXNlPHN0cmluZz4+ID0gbmV3IE1hcDxzdHJpbmcsIFByb21pc2U8c3RyaW5nPj4oKTtcbiAgcHJpdmF0ZSBfaG9zdENhY2hlS2V5cyA9IG5ldyBNYXA8VHlwZSwgYW55PigpO1xuICBwcml2YXRlIF9jb21waWxlZFRlbXBsYXRlQ2FjaGUgPSBuZXcgTWFwPGFueSwgQ29tcGlsZWRUZW1wbGF0ZT4oKTtcbiAgcHJpdmF0ZSBfY29tcGlsZWRUZW1wbGF0ZURvbmUgPSBuZXcgTWFwPGFueSwgUHJvbWlzZTxDb21waWxlZFRlbXBsYXRlPj4oKTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIF9ydW50aW1lTWV0YWRhdGFSZXNvbHZlcjogUnVudGltZU1ldGFkYXRhUmVzb2x2ZXIsXG4gICAgICAgICAgICAgIHByaXZhdGUgX3RlbXBsYXRlTm9ybWFsaXplcjogRGlyZWN0aXZlTm9ybWFsaXplcixcbiAgICAgICAgICAgICAgcHJpdmF0ZSBfdGVtcGxhdGVQYXJzZXI6IFRlbXBsYXRlUGFyc2VyLCBwcml2YXRlIF9zdHlsZUNvbXBpbGVyOiBTdHlsZUNvbXBpbGVyLFxuICAgICAgICAgICAgICBwcml2YXRlIF92aWV3Q29tcGlsZXI6IFZpZXdDb21waWxlciwgcHJpdmF0ZSBfeGhyOiBYSFIsXG4gICAgICAgICAgICAgIHByaXZhdGUgX2dlbkNvbmZpZzogQ29tcGlsZXJDb25maWcpIHt9XG5cbiAgcmVzb2x2ZUNvbXBvbmVudChjb21wb25lbnRUeXBlOiBUeXBlKTogUHJvbWlzZTxDb21wb25lbnRGYWN0b3J5PiB7XG4gICAgdmFyIGNvbXBNZXRhOiBDb21waWxlRGlyZWN0aXZlTWV0YWRhdGEgPVxuICAgICAgICB0aGlzLl9ydW50aW1lTWV0YWRhdGFSZXNvbHZlci5nZXREaXJlY3RpdmVNZXRhZGF0YShjb21wb25lbnRUeXBlKTtcbiAgICB2YXIgaG9zdENhY2hlS2V5ID0gdGhpcy5faG9zdENhY2hlS2V5cy5nZXQoY29tcG9uZW50VHlwZSk7XG4gICAgaWYgKGlzQmxhbmsoaG9zdENhY2hlS2V5KSkge1xuICAgICAgaG9zdENhY2hlS2V5ID0gbmV3IE9iamVjdCgpO1xuICAgICAgdGhpcy5faG9zdENhY2hlS2V5cy5zZXQoY29tcG9uZW50VHlwZSwgaG9zdENhY2hlS2V5KTtcbiAgICAgIGFzc2VydENvbXBvbmVudChjb21wTWV0YSk7XG4gICAgICB2YXIgaG9zdE1ldGE6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YSA9XG4gICAgICAgICAgY3JlYXRlSG9zdENvbXBvbmVudE1ldGEoY29tcE1ldGEudHlwZSwgY29tcE1ldGEuc2VsZWN0b3IpO1xuXG4gICAgICB0aGlzLl9sb2FkQW5kQ29tcGlsZUNvbXBvbmVudChob3N0Q2FjaGVLZXksIGhvc3RNZXRhLCBbY29tcE1ldGFdLCBbXSwgW10pO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fY29tcGlsZWRUZW1wbGF0ZURvbmUuZ2V0KGhvc3RDYWNoZUtleSlcbiAgICAgICAgLnRoZW4oKGNvbXBpbGVkVGVtcGxhdGU6IENvbXBpbGVkVGVtcGxhdGUpID0+IG5ldyBDb21wb25lbnRGYWN0b3J5KFxuICAgICAgICAgICAgICAgICAgY29tcE1ldGEuc2VsZWN0b3IsIGNvbXBpbGVkVGVtcGxhdGUudmlld0ZhY3RvcnksIGNvbXBvbmVudFR5cGUpKTtcbiAgfVxuXG4gIGNsZWFyQ2FjaGUoKSB7XG4gICAgdGhpcy5fc3R5bGVDYWNoZS5jbGVhcigpO1xuICAgIHRoaXMuX2NvbXBpbGVkVGVtcGxhdGVDYWNoZS5jbGVhcigpO1xuICAgIHRoaXMuX2NvbXBpbGVkVGVtcGxhdGVEb25lLmNsZWFyKCk7XG4gICAgdGhpcy5faG9zdENhY2hlS2V5cy5jbGVhcigpO1xuICB9XG5cblxuICBwcml2YXRlIF9sb2FkQW5kQ29tcGlsZUNvbXBvbmVudChjYWNoZUtleTogYW55LCBjb21wTWV0YTogQ29tcGlsZURpcmVjdGl2ZU1ldGFkYXRhLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2aWV3RGlyZWN0aXZlczogQ29tcGlsZURpcmVjdGl2ZU1ldGFkYXRhW10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpcGVzOiBDb21waWxlUGlwZU1ldGFkYXRhW10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBpbGluZ0NvbXBvbmVudHNQYXRoOiBhbnlbXSk6IENvbXBpbGVkVGVtcGxhdGUge1xuICAgIHZhciBjb21waWxlZFRlbXBsYXRlID0gdGhpcy5fY29tcGlsZWRUZW1wbGF0ZUNhY2hlLmdldChjYWNoZUtleSk7XG4gICAgdmFyIGRvbmUgPSB0aGlzLl9jb21waWxlZFRlbXBsYXRlRG9uZS5nZXQoY2FjaGVLZXkpO1xuICAgIGlmIChpc0JsYW5rKGNvbXBpbGVkVGVtcGxhdGUpKSB7XG4gICAgICBjb21waWxlZFRlbXBsYXRlID0gbmV3IENvbXBpbGVkVGVtcGxhdGUoKTtcbiAgICAgIHRoaXMuX2NvbXBpbGVkVGVtcGxhdGVDYWNoZS5zZXQoY2FjaGVLZXksIGNvbXBpbGVkVGVtcGxhdGUpO1xuICAgICAgZG9uZSA9XG4gICAgICAgICAgUHJvbWlzZVdyYXBwZXIuYWxsKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFs8YW55PnRoaXMuX2NvbXBpbGVDb21wb25lbnRTdHlsZXMoY29tcE1ldGEpXS5jb25jYXQodmlld0RpcmVjdGl2ZXMubWFwKFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkaXJNZXRhID0+IHRoaXMuX3RlbXBsYXRlTm9ybWFsaXplci5ub3JtYWxpemVEaXJlY3RpdmUoZGlyTWV0YSkpKSlcbiAgICAgICAgICAgICAgLnRoZW4oKHN0eWxlc0FuZE5vcm1hbGl6ZWRWaWV3RGlyTWV0YXM6IGFueVtdKSA9PiB7XG4gICAgICAgICAgICAgICAgdmFyIG5vcm1hbGl6ZWRWaWV3RGlyTWV0YXMgPSBzdHlsZXNBbmROb3JtYWxpemVkVmlld0Rpck1ldGFzLnNsaWNlKDEpO1xuICAgICAgICAgICAgICAgIHZhciBzdHlsZXMgPSBzdHlsZXNBbmROb3JtYWxpemVkVmlld0Rpck1ldGFzWzBdO1xuICAgICAgICAgICAgICAgIHZhciBwYXJzZWRUZW1wbGF0ZSA9XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX3RlbXBsYXRlUGFyc2VyLnBhcnNlKGNvbXBNZXRhLCBjb21wTWV0YS50ZW1wbGF0ZS50ZW1wbGF0ZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbm9ybWFsaXplZFZpZXdEaXJNZXRhcywgcGlwZXMsIGNvbXBNZXRhLnR5cGUubmFtZSk7XG5cbiAgICAgICAgICAgICAgICB2YXIgY2hpbGRQcm9taXNlcyA9IFtdO1xuICAgICAgICAgICAgICAgIGNvbXBpbGVkVGVtcGxhdGUuaW5pdCh0aGlzLl9jb21waWxlQ29tcG9uZW50KGNvbXBNZXRhLCBwYXJzZWRUZW1wbGF0ZSwgc3R5bGVzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpcGVzLCBjb21waWxpbmdDb21wb25lbnRzUGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGlsZFByb21pc2VzKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2VXcmFwcGVyLmFsbChjaGlsZFByb21pc2VzKS50aGVuKChfKSA9PiB7IHJldHVybiBjb21waWxlZFRlbXBsYXRlOyB9KTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICB0aGlzLl9jb21waWxlZFRlbXBsYXRlRG9uZS5zZXQoY2FjaGVLZXksIGRvbmUpO1xuICAgIH1cbiAgICByZXR1cm4gY29tcGlsZWRUZW1wbGF0ZTtcbiAgfVxuXG4gIHByaXZhdGUgX2NvbXBpbGVDb21wb25lbnQoY29tcE1ldGE6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YSwgcGFyc2VkVGVtcGxhdGU6IFRlbXBsYXRlQXN0W10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGVzOiBzdHJpbmdbXSwgcGlwZXM6IENvbXBpbGVQaXBlTWV0YWRhdGFbXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb21waWxpbmdDb21wb25lbnRzUGF0aDogYW55W10sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hpbGRQcm9taXNlczogUHJvbWlzZTxhbnk+W10pOiBGdW5jdGlvbiB7XG4gICAgdmFyIGNvbXBpbGVSZXN1bHQgPSB0aGlzLl92aWV3Q29tcGlsZXIuY29tcGlsZUNvbXBvbmVudChcbiAgICAgICAgY29tcE1ldGEsIHBhcnNlZFRlbXBsYXRlLFxuICAgICAgICBuZXcgaXIuRXh0ZXJuYWxFeHByKG5ldyBDb21waWxlSWRlbnRpZmllck1ldGFkYXRhKHtydW50aW1lOiBzdHlsZXN9KSksIHBpcGVzKTtcbiAgICBjb21waWxlUmVzdWx0LmRlcGVuZGVuY2llcy5mb3JFYWNoKChkZXApID0+IHtcbiAgICAgIHZhciBjaGlsZENvbXBpbGluZ0NvbXBvbmVudHNQYXRoID0gTGlzdFdyYXBwZXIuY2xvbmUoY29tcGlsaW5nQ29tcG9uZW50c1BhdGgpO1xuXG4gICAgICB2YXIgY2hpbGRDYWNoZUtleSA9IGRlcC5jb21wLnR5cGUucnVudGltZTtcbiAgICAgIHZhciBjaGlsZFZpZXdEaXJlY3RpdmVzOiBDb21waWxlRGlyZWN0aXZlTWV0YWRhdGFbXSA9XG4gICAgICAgICAgdGhpcy5fcnVudGltZU1ldGFkYXRhUmVzb2x2ZXIuZ2V0Vmlld0RpcmVjdGl2ZXNNZXRhZGF0YShkZXAuY29tcC50eXBlLnJ1bnRpbWUpO1xuICAgICAgdmFyIGNoaWxkVmlld1BpcGVzOiBDb21waWxlUGlwZU1ldGFkYXRhW10gPVxuICAgICAgICAgIHRoaXMuX3J1bnRpbWVNZXRhZGF0YVJlc29sdmVyLmdldFZpZXdQaXBlc01ldGFkYXRhKGRlcC5jb21wLnR5cGUucnVudGltZSk7XG4gICAgICB2YXIgY2hpbGRJc1JlY3Vyc2l2ZSA9IExpc3RXcmFwcGVyLmNvbnRhaW5zKGNoaWxkQ29tcGlsaW5nQ29tcG9uZW50c1BhdGgsIGNoaWxkQ2FjaGVLZXkpO1xuICAgICAgY2hpbGRDb21waWxpbmdDb21wb25lbnRzUGF0aC5wdXNoKGNoaWxkQ2FjaGVLZXkpO1xuXG4gICAgICB2YXIgY2hpbGRDb21wID1cbiAgICAgICAgICB0aGlzLl9sb2FkQW5kQ29tcGlsZUNvbXBvbmVudChkZXAuY29tcC50eXBlLnJ1bnRpbWUsIGRlcC5jb21wLCBjaGlsZFZpZXdEaXJlY3RpdmVzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoaWxkVmlld1BpcGVzLCBjaGlsZENvbXBpbGluZ0NvbXBvbmVudHNQYXRoKTtcbiAgICAgIGRlcC5mYWN0b3J5UGxhY2Vob2xkZXIucnVudGltZSA9IGNoaWxkQ29tcC5wcm94eVZpZXdGYWN0b3J5O1xuICAgICAgZGVwLmZhY3RvcnlQbGFjZWhvbGRlci5uYW1lID0gYHZpZXdGYWN0b3J5XyR7ZGVwLmNvbXAudHlwZS5uYW1lfWA7XG4gICAgICBpZiAoIWNoaWxkSXNSZWN1cnNpdmUpIHtcbiAgICAgICAgLy8gT25seSB3YWl0IGZvciBhIGNoaWxkIGlmIGl0IGlzIG5vdCBhIGN5Y2xlXG4gICAgICAgIGNoaWxkUHJvbWlzZXMucHVzaCh0aGlzLl9jb21waWxlZFRlbXBsYXRlRG9uZS5nZXQoY2hpbGRDYWNoZUtleSkpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHZhciBmYWN0b3J5O1xuICAgIGlmIChJU19EQVJUIHx8ICF0aGlzLl9nZW5Db25maWcudXNlSml0KSB7XG4gICAgICBmYWN0b3J5ID0gaW50ZXJwcmV0U3RhdGVtZW50cyhjb21waWxlUmVzdWx0LnN0YXRlbWVudHMsIGNvbXBpbGVSZXN1bHQudmlld0ZhY3RvcnlWYXIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBuZXcgSW50ZXJwcmV0aXZlQXBwVmlld0luc3RhbmNlRmFjdG9yeSgpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZmFjdG9yeSA9IGppdFN0YXRlbWVudHMoYCR7Y29tcE1ldGEudHlwZS5uYW1lfS50ZW1wbGF0ZS5qc2AsIGNvbXBpbGVSZXN1bHQuc3RhdGVtZW50cyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbXBpbGVSZXN1bHQudmlld0ZhY3RvcnlWYXIpO1xuICAgIH1cbiAgICByZXR1cm4gZmFjdG9yeTtcbiAgfVxuXG4gIHByaXZhdGUgX2NvbXBpbGVDb21wb25lbnRTdHlsZXMoY29tcE1ldGE6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICB2YXIgY29tcGlsZVJlc3VsdCA9IHRoaXMuX3N0eWxlQ29tcGlsZXIuY29tcGlsZUNvbXBvbmVudChjb21wTWV0YSk7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc29sdmVTdHlsZXNDb21waWxlUmVzdWx0KGNvbXBNZXRhLnR5cGUubmFtZSwgY29tcGlsZVJlc3VsdCk7XG4gIH1cblxuICBwcml2YXRlIF9yZXNvbHZlU3R5bGVzQ29tcGlsZVJlc3VsdChzb3VyY2VVcmw6IHN0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVzdWx0OiBTdHlsZXNDb21waWxlUmVzdWx0KTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIHZhciBwcm9taXNlcyA9IHJlc3VsdC5kZXBlbmRlbmNpZXMubWFwKChkZXApID0+IHRoaXMuX2xvYWRTdHlsZXNoZWV0RGVwKGRlcCkpO1xuICAgIHJldHVybiBQcm9taXNlV3JhcHBlci5hbGwocHJvbWlzZXMpXG4gICAgICAgIC50aGVuKChjc3NUZXh0cykgPT4ge1xuICAgICAgICAgIHZhciBuZXN0ZWRDb21waWxlUmVzdWx0UHJvbWlzZXMgPSBbXTtcbiAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlc3VsdC5kZXBlbmRlbmNpZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBkZXAgPSByZXN1bHQuZGVwZW5kZW5jaWVzW2ldO1xuICAgICAgICAgICAgdmFyIGNzc1RleHQgPSBjc3NUZXh0c1tpXTtcbiAgICAgICAgICAgIHZhciBuZXN0ZWRDb21waWxlUmVzdWx0ID1cbiAgICAgICAgICAgICAgICB0aGlzLl9zdHlsZUNvbXBpbGVyLmNvbXBpbGVTdHlsZXNoZWV0KGRlcC5zb3VyY2VVcmwsIGNzc1RleHQsIGRlcC5pc1NoaW1tZWQpO1xuICAgICAgICAgICAgbmVzdGVkQ29tcGlsZVJlc3VsdFByb21pc2VzLnB1c2goXG4gICAgICAgICAgICAgICAgdGhpcy5fcmVzb2x2ZVN0eWxlc0NvbXBpbGVSZXN1bHQoZGVwLnNvdXJjZVVybCwgbmVzdGVkQ29tcGlsZVJlc3VsdCkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gUHJvbWlzZVdyYXBwZXIuYWxsKG5lc3RlZENvbXBpbGVSZXN1bHRQcm9taXNlcyk7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKChuZXN0ZWRTdHlsZXNBcnIpID0+IHtcbiAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlc3VsdC5kZXBlbmRlbmNpZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBkZXAgPSByZXN1bHQuZGVwZW5kZW5jaWVzW2ldO1xuICAgICAgICAgICAgZGVwLnZhbHVlUGxhY2Vob2xkZXIucnVudGltZSA9IG5lc3RlZFN0eWxlc0FycltpXTtcbiAgICAgICAgICAgIGRlcC52YWx1ZVBsYWNlaG9sZGVyLm5hbWUgPSBgaW1wb3J0ZWRTdHlsZXMke2l9YDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKElTX0RBUlQgfHwgIXRoaXMuX2dlbkNvbmZpZy51c2VKaXQpIHtcbiAgICAgICAgICAgIHJldHVybiBpbnRlcnByZXRTdGF0ZW1lbnRzKHJlc3VsdC5zdGF0ZW1lbnRzLCByZXN1bHQuc3R5bGVzVmFyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbmV3IEludGVycHJldGl2ZUFwcFZpZXdJbnN0YW5jZUZhY3RvcnkoKSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBqaXRTdGF0ZW1lbnRzKGAke3NvdXJjZVVybH0uY3NzLmpzYCwgcmVzdWx0LnN0YXRlbWVudHMsIHJlc3VsdC5zdHlsZXNWYXIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9sb2FkU3R5bGVzaGVldERlcChkZXA6IFN0eWxlc0NvbXBpbGVEZXBlbmRlbmN5KTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB2YXIgY2FjaGVLZXkgPSBgJHtkZXAuc291cmNlVXJsfSR7ZGVwLmlzU2hpbW1lZCA/ICcuc2hpbScgOiAnJ31gO1xuICAgIHZhciBjc3NUZXh0UHJvbWlzZSA9IHRoaXMuX3N0eWxlQ2FjaGUuZ2V0KGNhY2hlS2V5KTtcbiAgICBpZiAoaXNCbGFuayhjc3NUZXh0UHJvbWlzZSkpIHtcbiAgICAgIGNzc1RleHRQcm9taXNlID0gdGhpcy5feGhyLmdldChkZXAuc291cmNlVXJsKTtcbiAgICAgIHRoaXMuX3N0eWxlQ2FjaGUuc2V0KGNhY2hlS2V5LCBjc3NUZXh0UHJvbWlzZSk7XG4gICAgfVxuICAgIHJldHVybiBjc3NUZXh0UHJvbWlzZTtcbiAgfVxufVxuXG5jbGFzcyBDb21waWxlZFRlbXBsYXRlIHtcbiAgdmlld0ZhY3Rvcnk6IEZ1bmN0aW9uID0gbnVsbDtcbiAgcHJveHlWaWV3RmFjdG9yeTogRnVuY3Rpb247XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMucHJveHlWaWV3RmFjdG9yeSA9ICh2aWV3VXRpbHMsIGNoaWxkSW5qZWN0b3IsIGNvbnRleHRFbCkgPT5cbiAgICAgICAgdGhpcy52aWV3RmFjdG9yeSh2aWV3VXRpbHMsIGNoaWxkSW5qZWN0b3IsIGNvbnRleHRFbCk7XG4gIH1cblxuICBpbml0KHZpZXdGYWN0b3J5OiBGdW5jdGlvbikgeyB0aGlzLnZpZXdGYWN0b3J5ID0gdmlld0ZhY3Rvcnk7IH1cbn1cblxuZnVuY3Rpb24gYXNzZXJ0Q29tcG9uZW50KG1ldGE6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YSkge1xuICBpZiAoIW1ldGEuaXNDb21wb25lbnQpIHtcbiAgICB0aHJvdyBuZXcgQmFzZUV4Y2VwdGlvbihgQ291bGQgbm90IGNvbXBpbGUgJyR7bWV0YS50eXBlLm5hbWV9JyBiZWNhdXNlIGl0IGlzIG5vdCBhIGNvbXBvbmVudC5gKTtcbiAgfVxufVxuIl19