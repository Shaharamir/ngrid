import { Observable, of, Subject } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { ChangeDetectorRef, ElementRef, Injector, IterableDiffers, NgZone, ViewContainerRef } from '@angular/core';
import { Directionality } from '@angular/cdk/bidi';

import { PblNgridInternalExtensionApi } from '../ext/grid-ext-api';
import { ColumnApi, PblColumnStore } from './column/management';
import { PblNgridComponent } from './ngrid.component';
import { PblCdkTableComponent } from './pbl-cdk-table/pbl-cdk-table.component';
import { PblRowsApi } from './row/rows-api';
import { PblNgridCellFactoryResolver } from './row/cell-factory.service';
import { DynamicColumnWidthLogic, DYNAMIC_PADDING_BOX_MODEL_SPACE_STRATEGY } from './column/width-logic/dynamic-column-width';
import { ContextApi } from './context/api';
import { PblNgridMetaRowService } from './meta-rows/meta-row.service';
import { PblNgridPluginContext } from '../ext/plugin-control';
import { OnPropChangedEvent, OnPropChangedProperties, PblNgridEvents } from '../ext/types';
import { bindToDataSource } from './bind-to-datasource';
import { PblCdkVirtualScrollViewportComponent } from './features/virtual-scroll/virtual-scroll-viewport.component';

import './bind-to-datasource'; // LEAVE THIS, WE NEED IT SO THE AUGMENTATION IN THE FILE WILL LOAD.

export interface RequiredAngularTokens {
  ngZone: NgZone;
  injector: Injector;
  vcRef: ViewContainerRef;
  cdRef: ChangeDetectorRef;
  elRef: ElementRef<HTMLElement>;
  dir?: Directionality;
}

export function createApis<T>(grid: PblNgridComponent<T>, tokens: RequiredAngularTokens) {
  return new InternalExtensionApi(grid, tokens);
}

class InternalExtensionApi<T = any> implements PblNgridInternalExtensionApi<T> {
  readonly element: HTMLElement;
  readonly propChanged: Observable<OnPropChangedEvent>;
  readonly columnStore: PblColumnStore;
  readonly columnApi: ColumnApi<T>;
  readonly metaRowService: PblNgridMetaRowService<T>;
  readonly rowsApi: PblRowsApi<T>;
  readonly events: Observable<PblNgridEvents>;
  readonly plugin: PblNgridPluginContext;

  get cdkTable() { return this._cdkTable; }
  get contextApi() { return this._contextApi || (this._contextApi = new ContextApi<T>(this)); }
  get viewport(): PblCdkVirtualScrollViewportComponent { return this._viewPort; }
  get pluginCtrl() { return this.plugin.controller; }

  private _cdkTable: PblCdkTableComponent<T>;
  private _contextApi: ContextApi<T>;
  private _viewPort: PblCdkVirtualScrollViewportComponent;
  private _create: () => void;
  private dir?: Directionality;
  private readonly _propChanged: Subject<OnPropChangedEvent>;

  constructor(public readonly grid: PblNgridComponent<T>, tokens: RequiredAngularTokens) {
    this.propChanged = this._propChanged = new Subject<OnPropChangedEvent>();

    this.element = tokens.elRef.nativeElement;
    if (tokens.dir) {
      this.dir = tokens.dir;
    }

    const { plugin, init } = this.createPlugin(tokens);
    this._create = init;
    this.plugin = plugin;
    this.events = plugin.events;
    this.columnStore = new PblColumnStore(grid, tokens.injector.get(IterableDiffers));

    const cellFactory = tokens.injector.get(PblNgridCellFactoryResolver);
    this.rowsApi = new PblRowsApi<T>(this, tokens.ngZone, cellFactory);

    this.columnApi = ColumnApi.create<T>(this);
    this.metaRowService = new PblNgridMetaRowService(this);
    this._contextApi = new ContextApi<T>(this);
    bindToDataSource(this);

    this.events.subscribe( e => {
      if (e.kind === 'onDestroy') {
        this._propChanged.complete();
      }
    });
  }

  getDirection() {
    return this.dir?.value ?? 'ltr';
  }

  onConstructed(fn: () => void) {
    if (!this._create) {
      of(false);
    } else {
      this.events.pipe(filter(e => e.kind === 'onConstructed'), take(1)).subscribe(fn);
    }
  }

  onInit(fn: () => void) {
    this.plugin.controller.onInit().subscribe(fn);
  }

  setCdkTable(cdkTable: PblCdkTableComponent<T>) {
    this._cdkTable = cdkTable;
    const globalCreateEvent = this._create;
    delete this._create;
    this.plugin.emitEvent({ kind: 'onConstructed' });
    globalCreateEvent();
  }

  setViewport(viewport: PblCdkVirtualScrollViewportComponent) {
    this._viewPort = viewport;
  }

  dynamicColumnWidthFactory(): DynamicColumnWidthLogic {
    return new DynamicColumnWidthLogic(DYNAMIC_PADDING_BOX_MODEL_SPACE_STRATEGY, this.dir?.value);
  }

  notifyPropChanged(source, key, prev, curr) {
    if (prev !== curr) {
      this._propChanged.next({source, key, prev, curr} as any);
    }
  }

  private createPlugin(tokens: RequiredAngularTokens) {
    // Create an injector for the extensions/plugins
    // This injector allow plugins (that choose so) to provide a factory function for runtime use.
    // I.E: as if they we're created by angular via template...
    // This allows seamless plugin-to-plugin dependencies without requiring specific template syntax.
    // And also allows auto plugin binding (app wide) without the need for template syntax.
    const pluginInjector = Injector.create({
      providers: [
        { provide: ViewContainerRef, useValue: tokens.vcRef },
        { provide: ElementRef, useValue: tokens.elRef },
        { provide: ChangeDetectorRef, useValue: tokens.cdRef },
      ],
      parent: tokens.injector,
    });
    return PblNgridPluginContext.create(pluginInjector, this);
  }
}