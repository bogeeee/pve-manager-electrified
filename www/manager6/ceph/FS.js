Ext.define('PVE.CephCreateFS', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveCephCreateFS',

    showTaskViewer: true,
    onlineHelp: 'pveceph_fs_create',

    subject: 'Ceph FS',
    isCreate: true,
    method: 'POST',

    setFSName: function (fsName) {
        var me = this;

        if (fsName === '' || fsName === undefined) {
            fsName = 'cephfs';
        }

        me.url = '/nodes/' + me.nodename + '/ceph/fs/' + fsName;
    },

    items: [
        {
            xtype: 'textfield',
            fieldLabel: gettext('Name'),
            name: 'name',
            value: 'cephfs',
            listeners: {
                change: function (f, value) {
                    this.up('pveCephCreateFS').setFSName(value);
                },
            },
            submitValue: false, // already encoded in apicall URL
            emptyText: 'cephfs',
        },
        {
            xtype: 'proxmoxintegerfield',
            fieldLabel: 'Placement Groups',
            name: 'pg_num',
            value: 128,
            emptyText: 128,
            minValue: 8,
            maxValue: 32768,
            allowBlank: false,
        },
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Add as Storage'),
            value: true,
            name: 'add-storage',
            autoEl: {
                tag: 'div',
                'data-qtip': gettext('Add the new CephFS to the cluster storage configuration.'),
            },
        },
    ],

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        me.setFSName();

        me.callParent();
    },
});

Ext.define(
    'PVE.NodeCephFSPanel',
    {
        extend: 'Ext.panel.Panel',
        xtype: 'pveNodeCephFSPanel',
        mixins: ['Proxmox.Mixin.CBind'],

        title: gettext('CephFS'),
        onlineHelp: 'pveceph_fs',

        border: false,
        defaults: {
            border: false,
            cbind: {
                nodename: '{nodename}',
            },
        },

        viewModel: {
            parent: null,
            data: {
                mdsCount: 0,
            },
            formulas: {
                canCreateFS: function (get) {
                    return get('mdsCount') > 0;
                },
            },
        },

        items: [
            {
                xtype: 'grid',
                emptyText: Ext.String.format(gettext('No {0} configured.'), 'CephFS'),
                controller: {
                    xclass: 'Ext.app.ViewController',

                    init: function (view) {
                        view.rstore = Ext.create('Proxmox.data.UpdateStore', {
                            autoLoad: true,
                            xtype: 'update',
                            interval: 5 * 1000,
                            autoStart: true,
                            storeid: 'pve-ceph-fs',
                            proxy: {
                                type: 'proxmox',
                                url: `/api2/json/nodes/${view.nodename}/ceph/fs`,
                            },
                            model: 'pve-ceph-fs',
                        });
                        view.setStore(
                            Ext.create('Proxmox.data.DiffStore', {
                                rstore: view.rstore,
                                sorters: {
                                    property: 'name',
                                    direction: 'ASC',
                                },
                            }),
                        );
                        // manages the "install ceph?" overlay
                        PVE.Utils.monitor_ceph_installed(view, view.rstore, view.nodename, true);
                        view.on('destroy', () => view.rstore.stopUpdate());
                    },

                    onCreate: function () {
                        let view = this.getView();
                        view.rstore.stopUpdate();
                        Ext.create('PVE.CephCreateFS', {
                            autoShow: true,
                            nodename: view.nodename,
                            listeners: {
                                destroy: () => view.rstore.startUpdate(),
                            },
                        });
                    },
                },
                tbar: [
                    {
                        text: gettext('Create CephFS'),
                        reference: 'createButton',
                        handler: 'onCreate',
                        bind: {
                            disabled: '{!canCreateFS}',
                        },
                    },
                ],
                columns: [
                    {
                        header: gettext('Name'),
                        flex: 1,
                        dataIndex: 'name',
                        renderer: Ext.htmlEncode,
                    },
                    {
                        header: gettext('Data Pool'),
                        flex: 1,
                        dataIndex: 'data_pool',
                        renderer: Ext.htmlEncode,
                    },
                    {
                        header: gettext('Metadata Pool'),
                        flex: 1,
                        dataIndex: 'metadata_pool',
                        renderer: Ext.htmlEncode,
                    },
                ],
                cbind: {
                    nodename: '{nodename}',
                },
            },
            {
                xtype: 'pveNodeCephMDSList',
                title: gettext('Metadata Servers'),
                stateId: 'grid-ceph-mds',
                type: 'mds',
                storeLoadCallback: function (store, records, success) {
                    var vm = this.getViewModel();
                    if (!success || !records) {
                        vm.set('mdsCount', 0);
                        return;
                    }
                    let count = 0;
                    for (const mds of records) {
                        if (mds.data.state === 'up:standby') {
                            count++;
                        }
                    }
                    vm.set('mdsCount', count);
                },
                cbind: {
                    nodename: '{nodename}',
                },
            },
        ],
    },
    function () {
        Ext.define('pve-ceph-fs', {
            extend: 'Ext.data.Model',
            fields: ['name', 'data_pool', 'metadata_pool'],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/nodes/localhost/ceph/fs',
            },
            idProperty: 'name',
        });
    },
);
