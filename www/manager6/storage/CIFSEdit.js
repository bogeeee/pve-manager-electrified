Ext.define('PVE.storage.CIFSScan', {
    extend: 'Ext.form.field.ComboBox',
    alias: 'widget.pveCIFSScan',

    queryParam: 'server',

    valueField: 'share',
    displayField: 'share',
    matchFieldWidth: false,
    listConfig: {
        loadingText: gettext('Scanning...'),
        width: 350,
    },
    doRawQuery: Ext.emptyFn,

    onTriggerClick: function () {
        var me = this;

        if (!me.queryCaching || me.lastQuery !== me.cifsServer) {
            me.store.removeAll();
        }

        var params = {};
        if (me.cifsUsername) {
            params.username = me.cifsUsername;
        }
        if (me.cifsPassword) {
            params.password = me.cifsPassword;
        }
        if (me.cifsDomain) {
            params.domain = me.cifsDomain;
        }

        me.store.getProxy().setExtraParams(params);
        me.allQuery = me.cifsServer;

        me.callParent();
    },

    resetProxy: function () {
        let me = this;
        me.lastQuery = null;
        if (!me.readOnly && !me.disabled) {
            if (me.isExpanded) {
                me.collapse();
            }
        }
    },

    setServer: function (server) {
        if (this.cifsServer !== server) {
            this.cifsServer = server;
            this.resetProxy();
        }
    },
    setUsername: function (username) {
        if (this.cifsUsername !== username) {
            this.cifsUsername = username;
            this.resetProxy();
        }
    },
    setPassword: function (password) {
        if (this.cifsPassword !== password) {
            this.cifsPassword = password;
            this.resetProxy();
        }
    },
    setDomain: function (domain) {
        if (this.cifsDomain !== domain) {
            this.cifsDomain = domain;
            this.resetProxy();
        }
    },

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            me.nodename = 'localhost';
        }

        let store = Ext.create('Ext.data.Store', {
            fields: ['description', 'share'],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/nodes/' + me.nodename + '/scan/cifs',
            },
        });
        store.sort('share', 'ASC');

        Ext.apply(me, {
            store: store,
        });

        me.callParent();

        let picker = me.getPicker();
        // don't use monStoreErrors directly, it doesn't copes well with comboboxes
        picker.mon(store, 'beforeload', function (s, operation, eOpts) {
            picker.unmask();
            delete picker.minHeight;
        });
        picker.mon(store.proxy, 'afterload', function (proxy, request, success) {
            if (success) {
                Proxmox.Utils.setErrorMask(picker, false);
                return;
            }
            let error = request._operation.getError();
            let msg = Proxmox.Utils.getResponseErrorMessage(error);
            if (msg) {
                picker.minHeight = 100;
            }
            Proxmox.Utils.setErrorMask(picker, msg);
        });
    },
});

Ext.define('PVE.storage.CIFSInputPanel', {
    extend: 'PVE.panel.StorageBase',

    onlineHelp: 'storage_cifs',

    onGetValues: function (values) {
        let me = this;

        if (values.password?.length === 0) {
            delete values.password;
        }
        if (values.username?.length === 0) {
            delete values.username;
        }
        if (values.subdir?.length === 0) {
            delete values.subdir;
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
                            let exportField = me.down('field[name=share]');
                            exportField.setServer(value);
                        }
                    },
                },
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'username',
                value: '',
                fieldLabel: gettext('Username'),
                emptyText: gettext('Guest user'),
                listeners: {
                    change: function (f, value) {
                        if (!me.isCreate) {
                            return;
                        }
                        var exportField = me.down('field[name=share]');
                        exportField.setUsername(value);
                    },
                },
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                inputType: 'password',
                name: 'password',
                value: me.isCreate ? '' : '********',
                emptyText: me.isCreate ? gettext('None') : '',
                fieldLabel: gettext('Password'),
                minLength: 1,
                listeners: {
                    change: function (f, value) {
                        let exportField = me.down('field[name=share]');
                        exportField.setPassword(value);
                    },
                },
            },
            {
                xtype: me.isCreate ? 'pveCIFSScan' : 'displayfield',
                name: 'share',
                value: '',
                fieldLabel: 'Share',
                allowBlank: false,
            },
        ];

        me.column2 = [
            {
                xtype: 'pveContentTypeSelector',
                name: 'content',
                value: 'images',
                multiSelect: true,
                fieldLabel: gettext('Content'),
                allowBlank: false,
            },
            {
                xtype: me.isCreate ? 'textfield' : 'displayfield',
                name: 'domain',
                value: me.isCreate ? '' : undefined,
                fieldLabel: gettext('Domain'),
                allowBlank: true,
                listeners: {
                    change: function (f, value) {
                        if (me.isCreate) {
                            let exportField = me.down('field[name=share]');
                            exportField.setDomain(value);
                        }
                    },
                },
            },
            {
                xtype: 'pmxDisplayEditField',
                editable: me.isCreate,
                name: 'subdir',
                fieldLabel: gettext('Subdirectory'),
                allowBlank: true,
                emptyText: gettext('/some/path'),
            },
        ];

        me.callParent();
    },
});
