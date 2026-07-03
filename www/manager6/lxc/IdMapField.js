Ext.define('PVE.lxc.IdMapField', {
    extend: 'Ext.form.FieldContainer',
    xtype: 'pveLxcIdMapField',

    layout: { type: 'vbox', align: 'stretch' },

    controller: {
        xclass: 'Ext.app.ViewController',

        control: {
            'grid proxmoxintegerfield,grid proxmoxKVComboBox': {
                change: function (widget, value) {
                    let me = this;
                    let record = widget.getWidgetRecord();
                    let column = widget.getWidgetColumn();
                    if (!record || !column) {
                        return;
                    }
                    record.set(column.dataIndex, value);
                    record.commit();
                    me.updateIdMapField();
                },
            },
        },

        onIdMapFieldChange: function (field, value) {
            let me = this;
            let passthrough = value === 'passthrough';
            let checkbox = me.lookup('passthrough');
            checkbox.suspendEvent('change');
            checkbox.setValue(passthrough);
            checkbox.resumeEvent('change');
            me.lookup('idmaps').setVisible(!passthrough);
            me.lookup('addIdMapButton').setVisible(!passthrough);
            me.lookup('clearIdMapButton').setVisible(!passthrough);

            let store = me.lookup('idmaps').getStore();
            if (!passthrough && value) {
                store.setData(
                    value.split(';').map((v) => {
                        let [type, ct, host, length] = v.split(':');
                        return { type, ct, host, length };
                    }),
                );
            } else {
                store.removeAll();
            }
        },

        onPassthroughCheckboxChange: function (checkbox, checked) {
            let me = this;
            let field = me.lookup('idmap');
            if (checked) {
                me.stashedIdMap = field.getValue();
                field.setValue('passthrough');
            } else {
                field.setValue(me.stashedIdMap || '');
            }
        },

        addIdMap: function () {
            let me = this;
            me.lookup('idmaps').getStore().add({ type: 'u', ct: '', host: '', length: '' });
            me.updateIdMapField();
        },

        removeIdMap: function (button) {
            let me = this;
            me.lookup('idmaps').getStore().remove(button.getWidgetRecord());
            me.updateIdMapField();
        },

        clearIdMap: function () {
            let me = this;
            me.lookup('idmaps').getStore().removeAll();
            me.updateIdMapField();
        },

        updateIdMapField: function () {
            let me = this;
            // skip incomplete rows so users adding a row don't submit "u:::"
            let value = me
                .lookup('idmaps')
                .getStore()
                .getRange()
                .filter(
                    ({ data: { type, ct, host, length } }) =>
                        type !== '' && ct !== '' && host !== '' && length !== '',
                )
                .map(({ data: { type, ct, host, length } }) => `${type}:${ct}:${host}:${length}`)
                .join(';');
            let field = me.lookup('idmap');
            field.suspendEvent('change');
            field.setValue(value);
            field.resumeEvent('change');
        },
    },

    items: [
        {
            xtype: 'proxmoxcheckbox',
            reference: 'passthrough',
            fieldLabel: gettext('ID Mapping'),
            boxLabel: gettext('Passthrough'),
            isFormField: false,
            listeners: {
                change: 'onPassthroughCheckboxChange',
            },
        },
        {
            xtype: 'grid',
            height: 170,
            scrollable: true,
            reference: 'idmaps',
            viewConfig: {
                emptyText: gettext('No ID maps configured'),
            },
            store: {
                fields: ['type', 'ct', 'host', 'length'],
                data: [],
            },
            columns: [
                {
                    text: gettext('ID Type'),
                    xtype: 'widgetcolumn',
                    dataIndex: 'type',
                    widget: {
                        xtype: 'proxmoxKVComboBox',
                        margin: '4 0',
                        allowBlank: false,
                        comboItems: [
                            ['u', 'UID'],
                            ['g', 'GID'],
                        ],
                    },
                    flex: 1,
                },
                {
                    text: gettext('Container ID'),
                    xtype: 'widgetcolumn',
                    dataIndex: 'ct',
                    widget: {
                        xtype: 'proxmoxintegerfield',
                        margin: '4 0',
                        emptyText: gettext('Container ID'),
                        allowBlank: false,
                        minValue: 0,
                    },
                    flex: 1,
                },
                {
                    text: gettext('Host ID'),
                    xtype: 'widgetcolumn',
                    dataIndex: 'host',
                    widget: {
                        xtype: 'proxmoxintegerfield',
                        margin: '4 0',
                        emptyText: gettext('Host ID'),
                        allowBlank: false,
                        minValue: 0,
                    },
                    flex: 1,
                },
                {
                    text: gettext('Range Size'),
                    xtype: 'widgetcolumn',
                    dataIndex: 'length',
                    widget: {
                        xtype: 'proxmoxintegerfield',
                        margin: '4 0',
                        emptyText: gettext('Range Size'),
                        allowBlank: false,
                        minValue: 1,
                    },
                    flex: 1,
                },
                {
                    xtype: 'widgetcolumn',
                    width: 40,
                    widget: {
                        xtype: 'button',
                        margin: '4 0',
                        iconCls: 'fa fa-trash-o',
                        handler: 'removeIdMap',
                    },
                },
            ],
        },
        {
            xtype: 'container',
            layout: { type: 'hbox' },
            defaults: { margin: '0 2' },
            items: [
                {
                    xtype: 'button',
                    reference: 'addIdMapButton',
                    text: gettext('Add'),
                    iconCls: 'fa fa-plus-circle',
                    handler: 'addIdMap',
                    flex: 1,
                },
                {
                    xtype: 'button',
                    reference: 'clearIdMapButton',
                    text: gettext('Clear'),
                    iconCls: 'fa fa-trash-o',
                    handler: 'clearIdMap',
                    flex: 1,
                },
            ],
        },
        {
            xtype: 'hidden',
            reference: 'idmap',
            name: 'idmap',
            listeners: {
                change: 'onIdMapFieldChange',
            },
        },
    ],
});
