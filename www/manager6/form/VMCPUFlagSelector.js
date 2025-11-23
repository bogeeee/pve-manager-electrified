Ext.define('PVE.form.VMCPUFlagSelector', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.vmcpuflagselector',

    mixins: {
        field: 'Ext.form.field.Field',
    },

    disableSelection: true,
    columnLines: false,
    selectable: false,
    hideHeaders: true,

    scrollable: 'y',
    height: 200,

    unkownFlags: [],

    store: {
        type: 'store',
        fields: ['name', { name: 'state', defaultValue: '=' }, 'description'],
        autoLoad: true,
        proxy: {
            type: 'proxmox',
            url: '/api2/json/nodes/localhost/capabilities/qemu/cpu-flags',
        },
        listeners: {
            update: function () {
                this.commitChanges();
            },
            refresh: function (store, eOpts) {
                let me = this;
                let view = me.view;

                if (store.adjustedForValue !== view.value) {
                    view.adjustStoreForValue();
                }
            },
        },
        adjustedForValue: undefined,
    },

    getValue: function () {
        let me = this;
        let store = me.getStore();

        if (!store.isLoaded()) {
            return me.value;
        }

        let flags = '';

        store.getData().each(function (rec) {
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

        flags += me.unkownFlags.join(';');

        return flags;
    },

    // Adjusts the store for the current value and determines the unkown flags based on what the
    // store does not know.
    adjustStoreForValue: function () {
        let me = this;
        let store = me.getStore();
        let value = me.value;

        me.unkownFlags = [];

        store.getData().each((rec) => rec.set('state', '='));

        let flags = value ? value.split(';') : [];
        flags.forEach(function (flag) {
            let sign = flag.substr(0, 1);
            flag = flag.substr(1);

            let rec = store.findRecord('name', flag, 0, false, true, true);
            if (rec !== null) {
                rec.set('state', sign);
            } else {
                me.unkownFlags.push(flag);
            }
        });

        store.adjustedForValue = value;
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
            dataIndex: 'state',
            renderer: function (v) {
                switch (v) {
                    case '=':
                        return 'Default';
                    case '-':
                        return 'Off';
                    case '+':
                        return 'On';
                    default:
                        return 'Unknown';
                }
            },
            width: 65,
        },
        {
            xtype: 'widgetcolumn',
            dataIndex: 'state',
            width: 95,
            onWidgetAttach: function (column, widget, record) {
                let val = record.get('state') || '=';
                widget.down('[inputValue=' + val + ']').setValue(true);
                // TODO: disable if selected CPU model and flag are incompatible
            },
            widget: {
                xtype: 'radiogroup',
                hideLabel: true,
                layout: 'hbox',
                validateOnChange: false,
                value: '=',
                listeners: {
                    change: function (f, value) {
                        let v = Object.values(value)[0];
                        f.getWidgetRecord().set('state', v);

                        let view = this.up('grid');
                        view.dirty = view.getValue() !== view.originalValue;
                        view.checkDirty();
                        //view.checkChange();
                    },
                },
                items: [
                    {
                        boxLabel: '-',
                        boxLabelAlign: 'before',
                        inputValue: '-',
                        isFormField: false,
                    },
                    {
                        checked: true,
                        inputValue: '=',
                        isFormField: false,
                    },
                    {
                        boxLabel: '+',
                        inputValue: '+',
                        isFormField: false,
                    },
                ],
            },
        },
        {
            dataIndex: 'name',
            width: 100,
        },
        {
            dataIndex: 'description',
            cellWrap: true,
            flex: 1,
        },
    ],

    initComponent: function () {
        let me = this;

        me.value = me.originalValue = '';
        me.store.view = me;

        me.callParent(arguments);
    },
});
