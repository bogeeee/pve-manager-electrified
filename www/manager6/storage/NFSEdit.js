Ext.define('PVE.storage.NFSScan', {
    extend: 'Ext.form.field.ComboBox',
    alias: 'widget.pveNFSScan',

    queryParam: 'server',

    valueField: 'path',
    displayField: 'path',
    matchFieldWidth: false,
    listConfig: {
        loadingText: gettext('Scanning...'),
        width: 350,
    },
    doRawQuery: function () {
        // do nothing
    },

    onTriggerClick: function () {
        var me = this;

        if (!me.queryCaching || me.lastQuery !== me.nfsServer) {
            me.store.removeAll();
        }

        me.allQuery = me.nfsServer;

        me.callParent();
    },

    setServer: function (server) {
        var me = this;

        me.nfsServer = server;
    },

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            me.nodename = 'localhost';
        }

        var store = Ext.create('Ext.data.Store', {
            fields: ['path', 'options'],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/nodes/' + me.nodename + '/scan/nfs',
            },
        });

        store.sort('path', 'ASC');

        Ext.apply(me, {
            store: store,
        });

        me.callParent();
    },
});

Ext.define('PVE.storage.NFSInputPanel', {
    extend: 'PVE.panel.StorageBase',

    onlineHelp: 'storage_nfs',

    options: [],

    onGetValues: function (values) {
        var me = this;

        var i;
        var res = [];
        for (i = 0; i < me.options.length; i++) {
            let item = me.options[i];
            if (!item.match(/^vers=(.*)$/)) {
                res.push(item);
            }
        }
        if (values.nfsversion && values.nfsversion !== '__default__') {
            res.push('vers=' + values.nfsversion);
        }
        delete values.nfsversion;
        values.options = res.join(',');
        if (values.options === '') {
            delete values.options;
            if (!me.isCreate) {
                values.delete = 'options';
            }
        }

        return me.callParent([values]);
    },

    setValues: function (values) {
        var me = this;
        if (values.options) {
            me.options = values.options.split(',');
            me.options.forEach(function (item) {
                var match = item.match(/^vers=(.*)$/);
                if (match) {
                    values.nfsversion = match[1];
                }
            });
        }
        return me.callParent([values]);
    },

    initComponent: function () {
        var me = this;

        me.column1 = [
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'server',
                value: '',
                fieldLabel: gettext('Server'),
                allowBlank: false,
                listeners: {
                    change: function (f, value) {
                        if (me.isCreate) {
                            let exportField = me.down('field[name=export]');
                            exportField.setServer(value);
                            exportField.setValue('');
                        }
                    },
                },
            },
            {
                xtype: me.isCreate ? 'pveNFSScan' : 'displayfield',
                name: 'export',
                value: '',
                fieldLabel: 'Export',
                allowBlank: false,
            },
            {
                xtype: 'pveContentTypeSelector',
                name: 'content',
                value: 'images',
                multiSelect: true,
                fieldLabel: gettext('Content'),
                allowBlank: false,
            },
        ];

        me.advancedColumn2 = [
            {
                xtype: 'proxmoxKVComboBox',
                fieldLabel: gettext('NFS Version'),
                name: 'nfsversion',
                value: '__default__',
                deleteEmpty: false,
                comboItems: [
                    ['__default__', Proxmox.Utils.defaultText],
                    ['3', '3'],
                    ['4', '4'],
                    ['4.1', '4.1'],
                    ['4.2', '4.2'],
                ],
            },
        ];

        me.callParent();
    },
});
