Ext.define('PVE.CephCreateService', {
    extend: 'Proxmox.window.Edit',
    mixins: ['Proxmox.Mixin.CBind'],
    xtype: 'pveCephCreateService',

    method: 'POST',
    isCreate: true,
    showProgress: true,
    width: 450,

    setNode: function (node) {
        let me = this;
        me.nodename = node;
        me.updateUrl();
    },
    setServiceID: function (value) {
        let me = this;
        me.serviceID = value;
        me.updateUrl();
    },
    updateUrl: function () {
        let me = this;
        let node = me.nodename;
        let serviceID = me.serviceID ?? me.nodename;

        me.url = `/nodes/${node}/ceph/${me.type}/${serviceID}`;
    },

    defaults: {
        labelWidth: 75,
    },
    items: [
        {
            xtype: 'pveNodeSelector',
            fieldLabel: gettext('Host'),
            selectCurNode: true,
            allowBlank: false,
            submitValue: false,
            listeners: {
                change: function (f, value) {
                    let view = this.up('pveCephCreateService');
                    view.lookup('mds-id').setValue(value);
                    view.setNode(value);
                },
            },
        },
        {
            xtype: 'textfield',
            reference: 'mds-id',
            fieldLabel: gettext('MDS ID'),
            regex: /^([a-zA-Z]([-a-zA-Z0-9]*[a-zA-Z0-9])?)$/,
            regexText: gettext(
                'ID may consist of alphanumeric characters and hyphen. It cannot start with a number or end in a hyphen.',
            ),
            submitValue: false,
            allowBlank: false,
            cbind: {
                disabled: (get) => get('type') !== 'mds',
                hidden: (get) => get('type') !== 'mds',
            },
            listeners: {
                change: function (f, value) {
                    let view = this.up('pveCephCreateService');
                    view.setServiceID(value);
                },
            },
        },
        {
            xtype: 'component',
            border: false,
            padding: '5 2',
            style: {
                fontSize: '12px',
            },
            userCls: 'pmx-hint',
            cbind: {
                hidden: (get) => get('type') !== 'mds',
            },
            html: gettext(
                'By using different IDs, you can have multiple MDS per node, which increases redundancy with more than one CephFS.',
            ),
        },
    ],

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        if (!me.type) {
            throw 'no type specified';
        }
        me.setNode(me.nodename);

        me.callParent();
    },
});

Ext.define('PVE.node.CephServiceController', {
    extend: 'Ext.app.ViewController',
    alias: 'controller.CephServiceList',

    render_status: (value, metadata, rec) => Ext.htmlEncode(value),

    render_version: function (value, metadata, rec) {
        if (value === undefined) {
            return '';
        }
        let view = this.getView();
        let host = rec.data.host,
            nodev = [0];
        if (view.nodeversions[host] !== undefined) {
            nodev = view.nodeversions[host].version.parts;
        }

        let icon = '';
        if (PVE.Utils.compare_ceph_versions(view.maxversion, nodev) > 0) {
            icon = PVE.Utils.get_ceph_icon_html('HEALTH_UPGRADE');
        } else if (PVE.Utils.compare_ceph_versions(nodev, value) > 0) {
            icon = PVE.Utils.get_ceph_icon_html('HEALTH_OLD');
        } else if (view.mixedversions) {
            icon = PVE.Utils.get_ceph_icon_html('HEALTH_OK');
        }
        return icon + value;
    },

    getMaxVersions: function (store, records, success) {
        if (!success || records.length < 1) {
            return;
        }
        let me = this;
        let view = me.getView();

        view.nodeversions = records[0].data.node;
        view.maxversion = [];
        view.mixedversions = false;
        for (const [_nodename, data] of Object.entries(view.nodeversions)) {
            let res = PVE.Utils.compare_ceph_versions(data.version.parts, view.maxversion);
            if (res !== 0 && view.maxversion.length > 0) {
                view.mixedversions = true;
            }
            if (res > 0) {
                view.maxversion = data.version.parts;
            }
        }
    },

    init: function (view) {
        if (view.pveSelNode) {
            view.nodename = view.pveSelNode.data.node;
        }
        if (!view.nodename) {
            throw 'no node name specified';
        }

        if (!view.type) {
            throw 'no type specified';
        }

        view.versionsstore = Ext.create('Proxmox.data.UpdateStore', {
            autoStart: true,
            interval: 10000,
            storeid: `ceph-versions-${view.type}-list${view.nodename}`,
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/ceph/metadata?scope=versions',
            },
        });
        view.versionsstore.on('load', this.getMaxVersions, this);
        view.on('destroy', view.versionsstore.stopUpdate);

        view.rstore = Ext.create('Proxmox.data.UpdateStore', {
            autoStart: true,
            interval: 3000,
            storeid: `ceph-${view.type}-list${view.nodename}`,
            model: 'ceph-service-list',
            proxy: {
                type: 'proxmox',
                url: `/api2/json/nodes/${view.nodename}/ceph/${view.type}`,
            },
        });

        view.setStore(
            Ext.create('Proxmox.data.DiffStore', {
                rstore: view.rstore,
                sorters: [{ property: 'name' }],
            }),
        );

        if (view.storeLoadCallback) {
            view.rstore.on('load', view.storeLoadCallback, this);
        }
        view.on('destroy', view.rstore.stopUpdate);

        if (view.showCephInstallMask) {
            PVE.Utils.monitor_ceph_installed(view, view.rstore, view.nodename, true);
        }
    },

    service_cmd: function (rec, cmd) {
        let view = this.getView();
        if (!rec.data.host) {
            Ext.Msg.alert(gettext('Error'), 'entry has no host');
            return;
        }
        let doRequest = function () {
            Proxmox.Utils.API2Request({
                url: `/nodes/${rec.data.host}/ceph/${cmd}`,
                method: 'POST',
                params: { service: view.type + '.' + rec.data.name },
                success: function (response, options) {
                    Ext.create('Proxmox.window.TaskProgress', {
                        autoShow: true,
                        upid: response.result.data,
                        taskDone: () => view.rstore.load(),
                    });
                },
                failure: (response, _opts) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
            });
        };
        if (cmd === 'stop' && ['mon', 'mds'].includes(view.type)) {
            Proxmox.Utils.API2Request({
                url: `/nodes/${rec.data.host}/ceph/cmd-safety`,
                params: {
                    service: view.type,
                    id: rec.data.name,
                    action: 'stop',
                },
                method: 'GET',
                success: function ({ result: { data } }) {
                    let stopText = {
                        mon: gettext('Stop MON'),
                        mds: gettext('Stop MDS'),
                    };
                    if (!data.safe) {
                        Ext.Msg.show({
                            title: ngettext('Warning', 'Warnings', 1),
                            message: data.status,
                            icon: Ext.Msg.WARNING,
                            buttons: Ext.Msg.OKCANCEL,
                            buttonText: { ok: stopText[view.type] },
                            fn: function (selection) {
                                if (selection === 'ok') {
                                    doRequest();
                                }
                            },
                        });
                    } else {
                        doRequest();
                    }
                },
                failure: (response, _opts) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
            });
        } else {
            doRequest();
        }
    },
    onChangeService: function (button) {
        let me = this;
        let record = me.getView().getSelection()[0];
        me.service_cmd(record, button.action);
    },

    showSyslog: function () {
        let view = this.getView();
        let rec = view.getSelection()[0];
        let service = `ceph-${view.type}@${rec.data.name}`;
        Ext.create('Ext.window.Window', {
            title: `${gettext('Syslog')}: ${service}`,
            autoShow: true,
            modal: true,
            width: 800,
            height: 400,
            layout: 'fit',
            items: [
                {
                    xtype: 'proxmoxLogView',
                    url: `/api2/extjs/nodes/${rec.data.host}/syslog?service=${encodeURIComponent(service)}`,
                    log_select_timespan: 1,
                },
            ],
        });
    },

    onCreate: function () {
        let view = this.getView();
        Ext.create('PVE.CephCreateService', {
            autoShow: true,
            nodename: view.nodename,
            subject: view.getTitle(),
            type: view.type,
            taskDone: () => view.rstore.load(),
        });
    },
});

Ext.define(
    'PVE.node.CephServiceList',
    {
        extend: 'Ext.grid.GridPanel',
        xtype: 'pveNodeCephServiceList',

        onlineHelp: 'chapter_pveceph',
        emptyText: gettext('No such service configured.'),

        stateful: true,

        // will be called when the store loads
        storeLoadCallback: Ext.emptyFn,

        // if set to true, does shows the ceph install mask if needed
        showCephInstallMask: false,

        controller: 'CephServiceList',

        tbar: [
            {
                xtype: 'proxmoxButton',
                text: gettext('Start'),
                iconCls: 'fa fa-play',
                action: 'start',
                disabled: true,
                enableFn: (rec) => rec.data.state === 'stopped' || rec.data.state === 'unknown',
                handler: 'onChangeService',
            },
            {
                xtype: 'proxmoxButton',
                text: gettext('Stop'),
                iconCls: 'fa fa-stop',
                action: 'stop',
                enableFn: (rec) => rec.data.state !== 'stopped',
                disabled: true,
                handler: 'onChangeService',
            },
            {
                xtype: 'proxmoxButton',
                text: gettext('Restart'),
                iconCls: 'fa fa-refresh',
                action: 'restart',
                disabled: true,
                enableFn: (rec) => rec.data.state !== 'stopped',
                handler: 'onChangeService',
            },
            '-',
            {
                text: gettext('Create'),
                reference: 'createButton',
                handler: 'onCreate',
            },
            {
                text: gettext('Destroy'),
                xtype: 'proxmoxStdRemoveButton',
                getUrl: function (rec) {
                    let view = this.up('grid');
                    if (!rec.data.host) {
                        Ext.Msg.alert(gettext('Error'), 'entry has no host, cannot build API url');
                        return '';
                    }
                    return `/nodes/${rec.data.host}/ceph/${view.type}/${rec.data.name}`;
                },
                callback: function (options, success, response) {
                    let view = this.up('grid');
                    if (!success) {
                        Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                        return;
                    }
                    Ext.create('Proxmox.window.TaskProgress', {
                        autoShow: true,
                        upid: response.result.data,
                        taskDone: () => view.rstore.load(),
                    });
                },
                handler: function (btn, event, rec) {
                    let me = this;
                    let view = me.up('grid');
                    let doRequest = function () {
                        Proxmox.button.StdRemoveButton.prototype.handler.call(me, btn, event, rec);
                    };
                    if (view.type === 'mon') {
                        Proxmox.Utils.API2Request({
                            url: `/nodes/${rec.data.host}/ceph/cmd-safety`,
                            params: {
                                service: view.type,
                                id: rec.data.name,
                                action: 'destroy',
                            },
                            method: 'GET',
                            success: function ({ result: { data } }) {
                                if (!data.safe) {
                                    Ext.Msg.show({
                                        title: ngettext('Warning', 'Warnings', 1),
                                        message: data.status,
                                        icon: Ext.Msg.WARNING,
                                        buttons: Ext.Msg.OKCANCEL,
                                        buttonText: { ok: gettext('Destroy MON') },
                                        fn: function (selection) {
                                            if (selection === 'ok') {
                                                doRequest();
                                            }
                                        },
                                    });
                                } else {
                                    doRequest();
                                }
                            },
                            failure: (response, _opts) =>
                                Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                        });
                    } else {
                        doRequest();
                    }
                },
            },
            '-',
            {
                xtype: 'proxmoxButton',
                text: gettext('Syslog'),
                disabled: true,
                handler: 'showSyslog',
            },
        ],

        columns: [
            {
                header: gettext('Name'),
                flex: 1,
                sortable: true,
                renderer: function (v) {
                    return this.type + '.' + v;
                },
                dataIndex: 'name',
            },
            {
                header: gettext('Host'),
                flex: 1,
                sortable: true,
                renderer: function (v) {
                    return v || Proxmox.Utils.unknownText;
                },
                dataIndex: 'host',
            },
            {
                header: gettext('Status'),
                flex: 1,
                sortable: false,
                renderer: 'render_status',
                dataIndex: 'state',
            },
            {
                header: gettext('Address'),
                flex: 3,
                sortable: true,
                renderer: function (v) {
                    return v || Proxmox.Utils.unknownText;
                },
                dataIndex: 'addr',
            },
            {
                header: gettext('Version'),
                flex: 3,
                sortable: true,
                dataIndex: 'version',
                renderer: 'render_version',
            },
        ],

        initComponent: function () {
            let me = this;

            if (me.additionalColumns) {
                me.columns = me.columns.concat(me.additionalColumns);
            }

            me.callParent();
        },
    },
    function () {
        Ext.define('ceph-service-list', {
            extend: 'Ext.data.Model',
            fields: [
                'addr',
                'name',
                'fs_name',
                'rank',
                'host',
                'quorum',
                'state',
                'ceph_version',
                'ceph_version_short',
                {
                    type: 'string',
                    name: 'version',
                    calculate: (data) => PVE.Utils.parse_ceph_version(data),
                },
            ],
            idProperty: 'name',
        });
    },
);

Ext.define('PVE.node.CephMDSServiceController', {
    extend: 'PVE.node.CephServiceController',
    alias: 'controller.CephServiceMDSList',

    render_status: (value, mD, rec) =>
        Ext.htmlEncode(rec.data.fs_name ? `${value} (${rec.data.fs_name})` : value),
});

Ext.define('PVE.node.CephMDSList', {
    extend: 'PVE.node.CephServiceList',
    xtype: 'pveNodeCephMDSList',

    controller: {
        type: 'CephServiceMDSList',
    },
});
