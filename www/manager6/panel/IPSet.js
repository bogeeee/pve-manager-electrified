Ext.define('pve-fw-ipsets', {
    extend: 'Ext.data.Model',
    fields: ['name', 'comment', 'digest'],
    idProperty: 'name',
});

Ext.define('PVE.IPSetList', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.pveIPSetList',

    stateful: true,
    stateId: 'grid-firewall-ipsetlist',

    ipset_panel: undefined,

    base_url: undefined,

    addBtn: undefined,
    removeBtn: undefined,
    editBtn: undefined,

    initComponent: function () {
        var me = this;

        if (typeof me.ipset_panel === 'undefined') {
            throw 'no rule panel specified';
        }

        if (typeof me.ipset_panel === 'undefined') {
            throw 'no base_url specified';
        }

        var store = new Ext.data.Store({
            model: 'pve-fw-ipsets',
            proxy: {
                type: 'proxmox',
                url: '/api2/json' + me.base_url,
            },
            sorters: {
                property: 'name',
                direction: 'ASC',
            },
        });

        var caps = Ext.state.Manager.get('GuiCap');
        let canEdit =
            !!caps.vms['VM.Config.Network'] ||
            !!caps.dc['Sys.Modify'] ||
            !!caps.nodes['Sys.Modify'];

        var sm = Ext.create('Ext.selection.RowModel', {});

        var reload = function () {
            var oldrec = sm.getSelection()[0];
            store.load(function (records, operation, success) {
                if (oldrec) {
                    let rec = store.findRecord('name', oldrec.data.name, 0, false, true, true);
                    if (rec) {
                        sm.select(rec);
                    }
                }
            });
        };

        var run_editor = function () {
            var rec = sm.getSelection()[0];
            if (!rec || !canEdit) {
                return;
            }
            var win = Ext.create('Proxmox.window.Edit', {
                subject: "IPSet '" + rec.data.name + "'",
                url: me.base_url,
                method: 'POST',
                digest: rec.data.digest,
                items: [
                    {
                        xtype: 'hiddenfield',
                        name: 'rename',
                        value: rec.data.name,
                    },
                    {
                        xtype: 'textfield',
                        name: 'name',
                        value: rec.data.name,
                        fieldLabel: gettext('Name'),
                        allowBlank: false,
                    },
                    {
                        xtype: 'textfield',
                        name: 'comment',
                        value: rec.data.comment,
                        fieldLabel: gettext('Comment'),
                    },
                ],
            });
            win.show();
            win.on('destroy', reload);
        };

        me.editBtn = new Proxmox.button.Button({
            text: gettext('Edit'),
            disabled: true,
            enableFn: (rec) => canEdit,
            selModel: sm,
            handler: run_editor,
        });

        me.addBtn = new Proxmox.button.Button({
            text: gettext('Create'),
            handler: function () {
                sm.deselectAll();
                var win = Ext.create('Proxmox.window.Edit', {
                    subject: 'IPSet',
                    url: me.base_url,
                    method: 'POST',
                    items: [
                        {
                            xtype: 'textfield',
                            name: 'name',
                            value: '',
                            fieldLabel: gettext('Name'),
                            allowBlank: false,
                        },
                        {
                            xtype: 'textfield',
                            name: 'comment',
                            value: '',
                            fieldLabel: gettext('Comment'),
                        },
                    ],
                });
                win.show();
                win.on('destroy', reload);
            },
        });

        me.removeBtn = Ext.create('Proxmox.button.StdRemoveButton', {
            enableFn: (rec) => canEdit,
            selModel: sm,
            baseurl: me.base_url + '/',
            callback: reload,
        });

        Ext.apply(me, {
            store: store,
            tbar: ['<b>IPSet:</b>', me.addBtn, me.removeBtn, me.editBtn],
            selModel: sm,
            columns: [
                {
                    header: 'IPSet',
                    dataIndex: 'name',
                    minWidth: 150,
                    flex: 1,
                },
                {
                    header: gettext('Comment'),
                    dataIndex: 'comment',
                    renderer: Ext.String.htmlEncode,
                    flex: 4,
                },
            ],
            listeners: {
                itemdblclick: run_editor,
                select: function (_, rec) {
                    var url = me.base_url + '/' + rec.data.name;
                    me.ipset_panel.setBaseUrl(url);
                },
                deselect: function () {
                    me.ipset_panel.setBaseUrl(undefined);
                },
                show: reload,
            },
        });

        if (!canEdit) {
            me.addBtn.setDisabled(true);
        }

        me.callParent();

        store.load();
    },
});

Ext.define('PVE.IPSetCidrEdit', {
    extend: 'Proxmox.window.Edit',

    cidr: undefined,

    initComponent: function () {
        var me = this;

        me.isCreate = me.cidr === undefined;

        if (me.isCreate) {
            me.url = '/api2/extjs' + me.base_url;
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs' + me.base_url + '/' + me.cidr;
            me.method = 'PUT';
        }

        var column1 = [];

        if (me.isCreate) {
            if (!me.list_refs_url) {
                throw 'no alias_base_url specified';
            }

            column1.push({
                xtype: 'pveIPRefSelector',
                name: 'cidr',
                ref_type: 'alias',
                autoSelect: false,
                editable: true,
                base_url: me.list_refs_url,
                allowBlank: false,
                fieldLabel: gettext('IP/CIDR'),
            });
        } else {
            column1.push({
                xtype: 'displayfield',
                name: 'cidr',
                value: '',
                fieldLabel: gettext('IP/CIDR'),
            });
        }

        var ipanel = Ext.create('Proxmox.panel.InputPanel', {
            isCreate: me.isCreate,
            column1: column1,
            column2: [
                {
                    xtype: 'proxmoxcheckbox',
                    name: 'nomatch',
                    checked: false,
                    uncheckedValue: 0,
                    fieldLabel: 'nomatch',
                },
            ],
            columnB: [
                {
                    xtype: 'textfield',
                    name: 'comment',
                    value: '',
                    fieldLabel: gettext('Comment'),
                },
            ],
        });

        Ext.apply(me, {
            subject: gettext('IP/CIDR'),
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    var values = response.result.data;
                    ipanel.setValues(values);
                },
            });
        }
    },
});

Ext.define(
    'PVE.IPSetGrid',
    {
        extend: 'Ext.grid.Panel',
        alias: 'widget.pveIPSetGrid',

        stateful: true,
        stateId: 'grid-firewall-ipsets',

        base_url: undefined,
        list_refs_url: undefined,

        addBtn: undefined,
        removeBtn: undefined,
        editBtn: undefined,

        setBaseUrl: function (url) {
            var me = this;

            me.base_url = url;

            if (url === undefined) {
                me.addBtn.setDisabled(true);
                me.store.removeAll();
            } else {
                if (me.canEdit) {
                    me.addBtn.setDisabled(false);
                }
                me.removeBtn.baseurl = url + '/';
                me.store.setProxy({
                    type: 'proxmox',
                    url: '/api2/json' + url,
                });

                me.store.load();
            }
        },

        initComponent: function () {
            var me = this;

            if (!me.list_refs_url) {
                throw 'no1 list_refs_url specified';
            }

            var store = new Ext.data.Store({
                model: 'pve-ipset',
            });

            var reload = function () {
                store.load();
            };

            var sm = Ext.create('Ext.selection.RowModel', {});

            me.caps = Ext.state.Manager.get('GuiCap');
            me.canEdit =
                !!me.caps.vms['VM.Config.Network'] ||
                !!me.caps.dc['Sys.Modify'] ||
                !!me.caps.nodes['Sys.Modify'];

            var run_editor = function () {
                var rec = sm.getSelection()[0];
                if (!rec || !me.canEdit) {
                    return;
                }
                var win = Ext.create('PVE.IPSetCidrEdit', {
                    base_url: me.base_url,
                    cidr: rec.data.cidr,
                });
                win.show();
                win.on('destroy', reload);
            };

            me.editBtn = new Proxmox.button.Button({
                text: gettext('Edit'),
                disabled: true,
                enableFn: (rec) => me.canEdit,
                selModel: sm,
                handler: run_editor,
            });

            me.addBtn = new Proxmox.button.Button({
                text: gettext('Add'),
                disabled: true,
                enableFn: (rec) => me.canEdit,
                handler: function () {
                    if (!me.base_url) {
                        return;
                    }
                    var win = Ext.create('PVE.IPSetCidrEdit', {
                        base_url: me.base_url,
                        list_refs_url: me.list_refs_url,
                    });
                    win.show();
                    win.on('destroy', reload);
                },
            });

            me.removeBtn = Ext.create('Proxmox.button.StdRemoveButton', {
                disabled: true,
                enableFn: (rec) => me.canEdit,
                selModel: sm,
                baseurl: me.base_url + '/',
                callback: reload,
            });

            var render_errors = function (value, metaData, record) {
                var errors = record.data.errors;
                if (errors) {
                    let msg = errors.cidr || errors.nomatch;
                    if (msg) {
                        metaData.tdCls = 'proxmox-invalid-row';
                        let html = Ext.htmlEncode(`<p>${Ext.htmlEncode(msg)}</p>`);
                        metaData.tdAttr = `data-qwidth=600 data-qtitle="ERROR" data-qtip="${html}"`;
                    }
                }
                return Ext.htmlEncode(value);
            };

            Ext.apply(me, {
                tbar: ['<b>IP/CIDR:</b>', me.addBtn, me.removeBtn, me.editBtn],
                store: store,
                selModel: sm,
                listeners: {
                    itemdblclick: run_editor,
                },
                columns: [
                    {
                        xtype: 'rownumberer',
                        // cannot use width on instantiation as rownumberer hard-wires that in the
                        // constructor to avoid being overridden by applyDefaults
                        minWidth: 40,
                    },
                    {
                        header: gettext('IP/CIDR'),
                        dataIndex: 'cidr',
                        minWidth: 150,
                        flex: 1,
                        renderer: function (value, metaData, record) {
                            value = render_errors(value, metaData, record);
                            if (record.data.nomatch) {
                                return '<b>! </b>' + value;
                            }
                            return value;
                        },
                    },
                    {
                        header: gettext('Comment'),
                        dataIndex: 'comment',
                        flex: 3,
                        renderer: function (value) {
                            return Ext.util.Format.htmlEncode(value);
                        },
                    },
                ],
            });

            me.callParent();

            if (me.base_url) {
                me.setBaseUrl(me.base_url); // load
            }
        },
    },
    function () {
        Ext.define('pve-ipset', {
            extend: 'Ext.data.Model',
            fields: [{ name: 'nomatch', type: 'boolean' }, 'cidr', 'comment', 'errors'],
            idProperty: 'cidr',
        });
    },
);

Ext.define('PVE.IPSet', {
    extend: 'Ext.panel.Panel',
    alias: 'widget.pveIPSet',

    title: 'IPSet',

    onlineHelp: 'pve_firewall_ip_sets',

    list_refs_url: undefined,

    initComponent: function () {
        var me = this;

        if (!me.list_refs_url) {
            throw 'no list_refs_url specified';
        }

        var ipset_panel = Ext.createWidget('pveIPSetGrid', {
            region: 'center',
            list_refs_url: me.list_refs_url,
            border: false,
        });

        var ipset_list = Ext.createWidget('pveIPSetList', {
            region: 'west',
            ipset_panel: ipset_panel,
            base_url: me.base_url,
            width: '50%',
            border: false,
            split: true,
        });

        Ext.apply(me, {
            layout: 'border',
            items: [ipset_list, ipset_panel],
            listeners: {
                show: function () {
                    ipset_list.fireEvent('show', ipset_list);
                },
            },
        });

        me.callParent();
    },
});
