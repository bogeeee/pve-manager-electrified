Ext.define('PVE.form.VMCPUFlagSelector', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.vmcpuflagselector',

    bufferedRenderer: false,

    mixins: {
        field: 'Ext.form.field.Field',
    },

    config: {
        // Show only the flags that may be set for a specific VM.
        restrictToVMFlags: true,
    },

    disableSelection: true,
    columnLines: false,
    selectable: false,

    scrollable: 'y',
    height: 200,

    emptyText: gettext('No CPU flags available'),

    store: {
        fields: [
            'name',
            { name: 'state', defaultValue: '=' },
            'description',
            'supported-on',
            'unknown',
        ],
        autoLoad: false,
        proxy: {
            type: 'proxmox',
            url: '/api2/json/nodes/localhost/capabilities/qemu/cpu-flags',
        },
        listeners: {
            update: function () {
                this.commitChanges();
            },
        },
    },

    supportedFilterFn: function (rec) {
        // nested-virt is a PVE-only shorthand resolved at VM start to svm or vmx;
        // keep it visible even on clusters where no node currently reports either.
        if (rec.get('name') === 'nested-virt') {
            return true;
        }
        let state = rec.get('state');
        if (state && state !== '=') {
            return true;
        }
        if (rec.get('unknown')) {
            return true;
        }
        let s = rec.get('supported-on');
        return Array.isArray(s) && s.length > 0;
    },

    getValue: function () {
        let me = this;
        let store = me.getStore();

        if (!store.isLoaded()) {
            return me.value;
        }

        let flags = '';

        // Get the values directly from the data source. Using store.getData() here
        // would iterate over the filtered values, potentially overwriting flags that
        // are set but currently filtered out by the search bar.
        let source = store.getDataSource();
        source.each(function (rec) {
            let s = rec.get('state');
            if (s && s !== '=') {
                let f = rec.get('name');
                if (flags === '') {
                    flags = s + f;
                } else {
                    flags += ';' + s + f;
                }
            }
        });

        return flags;
    },

    setArch: function (arch) {
        let me = this;
        me.arch = arch;
        // Snapshot pending edits so they survive the upcoming store reload.
        if (me.getStore().isLoaded()) {
            me.value = me.getValue();
        }
        let proxy = me.store.getProxy();
        if (arch) {
            proxy.setExtraParam('arch', arch);
        } else {
            delete proxy.extraParams.arch;
        }
        me.store.reload();
    },

    setKvm: function (kvm) {
        let me = this;
        kvm = kvm ?? 1;
        me.kvm = kvm;
        // Snapshot pending edits so they survive the upcoming store reload.
        if (me.getStore().isLoaded()) {
            me.value = me.getValue();
        }
        let proxy = me.store.getProxy();
        proxy.setExtraParam('accel', kvm === 1 ? 'kvm' : 'tcg');
        me.store.reload();
        let hint = me.down('#accelHint');
        if (hint) {
            hint.setText(
                Ext.String.format(gettext('Showing flags for {0}'), kvm === 1 ? 'KVM' : 'TCG'),
            );
        }
    },

    // Adjusts the store for the current value. Flags not known to the API are added to the store
    // as 'unknown' records so they stay visible and can be edited.
    adjustStoreForValue: function () {
        let me = this;
        let store = me.getStore();
        let value = me.value;

        // Clear any previously added unknown records.
        let unknownRecords = [];
        let source = store.getDataSource();
        source.each((rec) => {
            if (rec.get('unknown')) {
                unknownRecords.push(rec);
            } else {
                rec.set('state', '=');
            }
        });
        store.remove(unknownRecords);

        let newUnknownFlags = [];
        let addUnknownFlag = function (flag, sign) {
            newUnknownFlags.push({
                name: flag,
                state: sign,
                // A TCG-only flag will be flagged as unknown when `accel` is set to `kvm` and vice-versa, hence the very general wording.
                description: gettext(
                    'This flag is not available for the selected acceleration type and/or not supported by any node in the cluster. It is very likely to lead to VM startup failure. You can remove it by setting it to "Default".',
                ),
                unknown: true,
            });
        };

        let flags = value ? value.split(';') : [];
        flags.forEach(function (flag) {
            let sign = flag.substr(0, 1);
            flag = flag.substr(1);

            let rec = source.findBy((r) => r.get('name') === flag);
            if (rec !== null) {
                let supported = rec.get('supported-on');
                // Treat flags that are set in the config but not supported anywhere as unknown
                if (Array.isArray(supported) && supported.length === 0 && sign !== '=') {
                    store.remove(rec);
                    addUnknownFlag(flag, sign);
                } else {
                    rec.set('state', sign);
                    rec.commit();
                }
            } else {
                addUnknownFlag(flag, sign);
            }
        });

        // Make sure unknown flags are displayed at the top of the list
        // so users reconsider them.
        if (newUnknownFlags.length > 0) {
            store.insert(0, newUnknownFlags);
        }

        // Ext.js uses buffered rendering [0] for larger lists like this one.
        // AbstractView.refresh() [1], which was previously used here for refreshing,
        // destroys and recreates all row elements but the buffered renderer only
        // tracks a sliding window of DOM nodes, so the refresh skips rows outside
        // the buffer, which leads to some elements not being fully rendered.
        //
        // Firing the 'refresh' event allows whatever view is currently rendering the
        // table (i.e. buffered or not) to handle it accordingly.
        //
        // [0] https://docs.sencha.com/extjs/7.0.0/classic/Ext.grid.plugin.BufferedRenderer.html
        // [1] https://docs.sencha.com/extjs/7.0.0/classic/Ext.view.AbstractView.html#method-refresh
        store.fireEvent('refresh', store);
    },
    isDirty: function () {
        let me = this;
        return me.originalValue !== me.getValue();
    },
    setValue: function (value) {
        let me = this;

        me.value = value || '';

        if (me.getStore().isLoaded()) {
            me.adjustStoreForValue();
        } // if not yet loaded, the store will trigger the function

        let res = me.mixins.field.setValue.call(me, value);

        return res;
    },
    columns: [
        {
            text: gettext('Value'),
            xtype: 'widgetcolumn',
            dataIndex: 'state',
            sortable: true,
            width: 200,
            onWidgetAttach: function (column, widget, record) {
                widget.setValue(record.get('state') || '=');
                // TODO: disable if selected CPU model and flag are incompatible
            },
            widget: {
                xtype: 'segmentedbutton',
                allowMultiple: false,
                defaultUI: 'default-toolbar',
                value: '=',
                items: [
                    { text: gettext('Off'), value: '-', width: 50 },
                    { text: gettext('Default'), value: '=', width: 90 },
                    { text: gettext('On'), value: '+', width: 50 },
                ],
                listeners: {
                    change: function (f, value) {
                        let rec = f.getWidgetRecord();
                        if (!rec) {
                            return;
                        }
                        rec.set('state', value);

                        let grid = f.up('grid');
                        grid.dirty = grid.getValue() !== grid.originalValue;
                        grid.checkDirty();
                    },
                },
            },
        },
        {
            text: gettext('Flag'),
            dataIndex: 'name',
            width: 100,
        },
        {
            text: gettext('Description'),
            dataIndex: 'description',
            sortable: false,
            cellWrap: true,
            flex: 3,
        },
        {
            text: gettext('Supported On'),
            dataIndex: 'supported-on',
            cellWrap: true,
            flex: 1,
            renderer: (v) => (Array.isArray(v) ? v.join(', ') : ''),
        },
    ],
    initComponent: function () {
        let me = this;

        me.value = me.originalValue = '';

        me.dockedItems = [];

        if (!me.restrictToVMFlags) {
            me.dockedItems.push({
                xtype: 'toolbar',
                dock: 'top',
                items: [
                    {
                        xtype: 'pveRecordSearchField',
                        emptyText: gettext('Search name or description'),
                        width: 240,
                        searchFields: ['name', 'description'],
                    },
                    '->',
                    { xtype: 'tbtext', text: gettext('Accel') + ':' },
                    {
                        xtype: 'segmentedbutton',
                        allowMultiple: false,
                        items: [
                            { text: 'KVM', value: 1, pressed: true },
                            { text: 'TCG', value: 0 },
                        ],
                        listeners: {
                            change: function (field, value) {
                                field.up('grid').setKvm(value);
                            },
                        },
                    },
                    { xtype: 'tbtext', text: gettext('Nodes') + ':' },
                    {
                        xtype: 'combobox',
                        // Filter widget, not a form field - keep it out of the
                        // surrounding form's getValues() so the enclosing dialog
                        // doesn't submit an Ext auto-id as a bogus parameter.
                        submitValue: false,
                        isFormField: false,
                        multiSelect: true,
                        queryMode: 'local',
                        valueField: 'name',
                        displayField: 'name',
                        width: 200,
                        emptyText: gettext('Any'),
                        store: {
                            fields: ['name'],
                            proxy: { type: 'memory' },
                            sorters: 'name',
                        },
                        listeners: {
                            afterrender: function (combo) {
                                let nodes = [];
                                PVE.data.ResourceStore.each((rec) => {
                                    if (rec.get('type') === 'node') {
                                        nodes.push({ name: rec.get('node') });
                                    }
                                });
                                combo.getStore().loadData(nodes);
                            },
                            change: function (field, selected) {
                                let store = field.up('grid').getStore();
                                if (selected && selected.length > 0) {
                                    store.addFilter({
                                        id: 'nodes-filter',
                                        filterFn: (rec) => {
                                            // PVE shorthand, resolved at VM start - keep visible.
                                            if (rec.get('name') === 'nested-virt') {
                                                return true;
                                            }
                                            let supported = rec.get('supported-on');
                                            if (!Array.isArray(supported)) {
                                                return false;
                                            }
                                            return selected.every((n) => supported.includes(n));
                                        },
                                    });
                                } else {
                                    store.removeFilter('nodes-filter');
                                }
                            },
                        },
                    },
                ],
            });
        }

        me.dockedItems.push({
            xtype: 'toolbar',
            dock: 'bottom',
            padding: '0 5',
            items: [
                {
                    xtype: 'checkbox',
                    // Default-off in DC mode: cluster models may use flags no node reports.
                    checked: me.restrictToVMFlags,
                    submitValue: false,
                    isFormField: false,
                    boxLabel: gettext('Only show flags supported by at least one node'),
                    listeners: {
                        change: function (cb, checked) {
                            let grid = cb.up('grid');
                            let store = grid.getStore();
                            if (checked) {
                                store.addFilter({
                                    id: 'supported-filter',
                                    filterFn: grid.supportedFilterFn,
                                });
                            } else {
                                store.removeFilter('supported-filter');
                            }
                        },
                    },
                },
                '->',
                {
                    xtype: 'tbtext',
                    itemId: 'accelHint',
                    hidden: !me.restrictToVMFlags,
                    text: gettext('Showing flags for KVM'),
                    autoEl: {
                        tag: 'div',
                        'data-qtip': gettext(
                            "Some flags depend on the active acceleration; switch via the VM's Options tab.",
                        ),
                    },
                },
            ],
        });

        me.callParent(arguments);

        me.initialized = true;

        if (me.restrictToVMFlags) {
            me.getStore().addFilter({
                id: 'supported-filter',
                filterFn: me.supportedFilterFn,
            });
        }

        me.getStore().on('load', function (store, _, success) {
            if (success) {
                me.adjustStoreForValue();
                me.checkDirty();
            }
        });

        if (!me.restrictToVMFlags) {
            me.down('pveRecordSearchField').setTargetStore(me.getStore());
            me.getStore().getProxy().setUrl('/api2/json/cluster/qemu/cpu-flags');
            me.getStore().load();
        }
    },
});
