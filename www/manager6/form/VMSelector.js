/* filter is a javascript builtin, but extjs calls it also filter */
Ext.define('PVE.form.VMSelector', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.vmselector',

    mixins: {
        field: 'Ext.form.field.Field',
    },

    allowBlank: true,
    selectAll: false,
    isFormField: true,

    plugins: 'gridfilters',

    store: {
        model: 'PVEResources',
        sorters: 'vmid',
    },

    userCls: 'proxmox-tags-circle',

    columnsDeclaration: [
        {
            header: 'ID',
            dataIndex: 'vmid',
            width: 80,
            filter: {
                type: 'number',
            },
        },
        {
            header: gettext('Node'),
            dataIndex: 'node',
        },
        {
            header: gettext('Status'),
            dataIndex: 'status',
            filter: {
                type: 'list',
            },
        },
        {
            header: gettext('Name'),
            dataIndex: 'name',
            flex: 1,
            filter: {
                type: 'string',
            },
        },
        {
            header: gettext('Pool'),
            dataIndex: 'pool',
            filter: {
                type: 'list',
            },
        },
        {
            header: gettext('Type'),
            dataIndex: 'type',
            width: 120,
            renderer: function (value) {
                if (value === 'qemu') {
                    return gettext('Virtual Machine');
                } else if (value === 'lxc') {
                    return gettext('LXC Container');
                }

                return '';
            },
            filter: {
                type: 'list',
                store: {
                    data: [
                        { id: 'qemu', text: gettext('Virtual Machine') },
                        { id: 'lxc', text: gettext('LXC Container') },
                    ],
                    un: function () {
                        // Due to EXTJS-18711. we have to do a static list via a store but to avoid
                        // creating an object, we have to have an empty pseudo un function
                    },
                },
            },
        },
        {
            header: gettext('Tags'),
            dataIndex: 'tags',
            renderer: (tags) => PVE.Utils.renderTags(tags, PVE.UIOptions.tagOverrides),
            flex: 1,
        },
        {
            header: 'HA ' + gettext('Status'),
            dataIndex: 'hastate',
            flex: 1,
            filter: {
                type: 'list',
            },
        },
    ],

    // should be a list of 'dataIndex' values, if 'undefined' all declared columns will be included
    columnSelection: undefined,

    selModel: {
        selType: 'checkboxmodel',
        mode: 'SIMPLE',
    },

    checkChangeEvents: ['selectionchange', 'change'],

    listeners: {
        selectionchange: function () {
            // to trigger validity and error checks
            this.checkChange();
        },
    },

    getValue: function () {
        var me = this;
        if (me.savedValue !== undefined) {
            return me.savedValue;
        }
        var sm = me.getSelectionModel();
        var selection = sm.getSelection();
        var values = [];
        var store = me.getStore();
        selection.forEach(function (item) {
            // only add if not filtered
            if (store.findExact('vmid', item.data.vmid) !== -1) {
                values.push(item.data.vmid);
            }
        });
        return values;
    },

    setValueSelection: function (value) {
        let me = this;

        let store = me.getStore();
        let notFound = [];
        let selection = value
            .map((item) => {
                let found = store.findRecord('vmid', item, 0, false, true, true);
                if (!found) {
                    if (Ext.isNumeric(item)) {
                        notFound.push(item);
                    } else {
                        console.warn(`invalid item in vm selection: ${item}`);
                    }
                }
                return found;
            })
            .filter((r) => r);

        for (const vmid of notFound) {
            let rec = store.add({
                vmid,
                node: 'unknown',
            });
            selection.push(rec[0]);
        }

        let sm = me.getSelectionModel();
        if (selection.length) {
            sm.select(selection);
        } else {
            sm.deselectAll();
        }
        // to correctly trigger invalid class
        me.getErrors();
    },

    setValue: function (value) {
        let me = this;
        value ??= [];
        if (!Ext.isArray(value)) {
            value = value.split(',').filter((v) => v !== '');
        }

        let store = me.getStore();
        if (!store.isLoaded()) {
            me.savedValue = value;
            store.on(
                'load',
                function () {
                    me.setValueSelection(value);
                    delete me.savedValue;
                },
                { single: true },
            );
        } else {
            me.setValueSelection(value);
        }
        return me.mixins.field.setValue.call(me, value);
    },

    getErrors: function (value) {
        let me = this;
        if (!me.isDisabled() && me.allowBlank === false && me.getValue().length === 0) {
            me.addBodyCls(['x-form-trigger-wrap-default', 'x-form-trigger-wrap-invalid']);
            return [gettext('No VM selected')];
        }

        me.removeBodyCls(['x-form-trigger-wrap-default', 'x-form-trigger-wrap-invalid']);
        return [];
    },

    setDisabled: function (disabled) {
        let me = this;
        let res = me.callParent([disabled]);
        me.getErrors();
        return res;
    },

    initComponent: function () {
        let me = this;

        let columns = me.columnsDeclaration
            .filter((column) =>
                me.columnSelection ? me.columnSelection.indexOf(column.dataIndex) !== -1 : true,
            )
            .map((x) => x);

        me.columns = columns;

        me.callParent();

        me.getStore().load({ params: { type: 'vm' } });

        if (me.nodename) {
            me.getStore().addFilter({
                property: 'node',
                exactMatch: true,
                value: me.nodename,
            });
        }

        // only show the relevant guests by default
        if (me.action) {
            let statusfilter = '';
            switch (me.action) {
                case 'startall':
                    statusfilter = 'stopped';
                    break;
                case 'stopall':
                    statusfilter = 'running';
                    break;
            }
            if (statusfilter !== '') {
                me.getStore().addFilter([
                    {
                        property: 'template',
                        value: 0,
                    },
                    {
                        id: 'x-gridfilter-status',
                        operator: 'in',
                        property: 'status',
                        value: [statusfilter],
                    },
                ]);
            }
        }

        if (me.selectAll) {
            me.mon(me.getStore(), 'load', function () {
                me.getSelectionModel().selectAll(false);
            });
        }
    },
});

Ext.define('PVE.form.VMComboSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: 'widget.vmComboSelector',

    valueField: 'vmid',
    displayField: 'vmid',

    autoSelect: false,
    editable: true,
    anyMatch: true,
    forceSelection: true,

    store: {
        model: 'PVEResources',
        autoLoad: true,
        sorters: 'vmid',
        filters: [
            {
                property: 'type',
                value: /lxc|qemu/,
            },
        ],
    },

    listConfig: {
        width: 600,
        plugins: 'gridfilters',
        columns: [
            {
                header: 'ID',
                dataIndex: 'vmid',
                width: 80,
                filter: {
                    type: 'number',
                },
            },
            {
                header: gettext('Name'),
                dataIndex: 'name',
                flex: 1,
                filter: {
                    type: 'string',
                },
            },
            {
                header: gettext('Node'),
                dataIndex: 'node',
            },
            {
                header: gettext('Status'),
                dataIndex: 'status',
                filter: {
                    type: 'list',
                },
            },
            {
                header: gettext('Pool'),
                dataIndex: 'pool',
                hidden: true,
                filter: {
                    type: 'list',
                },
            },
            {
                header: gettext('Type'),
                dataIndex: 'type',
                width: 120,
                renderer: function (value) {
                    if (value === 'qemu') {
                        return gettext('Virtual Machine');
                    } else if (value === 'lxc') {
                        return gettext('LXC Container');
                    }

                    return '';
                },
                filter: {
                    type: 'list',
                    store: {
                        data: [
                            { id: 'qemu', text: gettext('Virtual Machine') },
                            { id: 'lxc', text: gettext('LXC Container') },
                        ],
                        un: function () {
                            /* due to EXTJS-18711 */
                        },
                    },
                },
            },
            {
                header: 'HA ' + gettext('Status'),
                dataIndex: 'hastate',
                hidden: true,
                flex: 1,
                filter: {
                    type: 'list',
                },
            },
        ],
    },
});
