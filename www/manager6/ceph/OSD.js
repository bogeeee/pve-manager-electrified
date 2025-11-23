Ext.define('PVE.CephCreateOsd', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveCephCreateOsd',

    subject: 'Ceph OSD',

    showProgress: true,

    onlineHelp: 'pve_ceph_osds',

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        me.isCreate = true;

        Proxmox.Utils.API2Request({
            url: `/nodes/${me.nodename}/ceph/crush`,
            method: 'GET',
            failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
            success: function ({ result: { data } }) {
                let classes = [
                    ...new Set(
                        Array.from(
                            data.matchAll(/^device\s[0-9]*\sosd\.[0-9]*\sclass\s(.*)$/gim),
                            (m) => m[1],
                        ).filter((v) => !['hdd', 'ssd', 'nvme'].includes(v)),
                    ),
                ].map((v) => [v, v]);

                if (classes.length) {
                    let kvField = me.down('field[name=crush-device-class]');
                    kvField.setComboItems([...kvField.comboItems, ...classes]);
                }
            },
        });

        Ext.applyIf(me, {
            url: '/nodes/' + me.nodename + '/ceph/osd',
            method: 'POST',
            items: [
                {
                    xtype: 'inputpanel',
                    onGetValues: function (values) {
                        Object.keys(values || {}).forEach(function (name) {
                            if (values[name] === '') {
                                delete values[name];
                            }
                        });

                        return values;
                    },
                    column1: [
                        {
                            xtype: 'pmxDiskSelector',
                            name: 'dev',
                            nodename: me.nodename,
                            diskType: 'unused',
                            includePartitions: true,
                            fieldLabel: gettext('Disk'),
                            allowBlank: false,
                        },
                    ],
                    column2: [
                        {
                            xtype: 'pmxDiskSelector',
                            name: 'db_dev',
                            nodename: me.nodename,
                            diskType: 'journal_disks',
                            includePartitions: true,
                            fieldLabel: gettext('DB Disk'),
                            value: '',
                            autoSelect: false,
                            allowBlank: true,
                            emptyText: gettext('use OSD disk'),
                            listeners: {
                                change: function (field, val) {
                                    me.down('field[name=db_dev_size]').setDisabled(!val);
                                },
                            },
                        },
                        {
                            xtype: 'numberfield',
                            name: 'db_dev_size',
                            fieldLabel: `${gettext('DB size')} (${gettext('GiB')})`,
                            minValue: 1,
                            maxValue: 128 * 1024,
                            decimalPrecision: 2,
                            allowBlank: true,
                            disabled: true,
                            emptyText: gettext('Automatic'),
                        },
                    ],
                    advancedColumn1: [
                        {
                            xtype: 'proxmoxcheckbox',
                            name: 'encrypted',
                            fieldLabel: gettext('Encrypt OSD'),
                        },
                        {
                            xtype: 'proxmoxKVComboBox',
                            comboItems: [
                                ['hdd', 'HDD'],
                                ['ssd', 'SSD'],
                                ['nvme', 'NVMe'],
                            ],
                            name: 'crush-device-class',
                            nodename: me.nodename,
                            fieldLabel: gettext('Device Class'),
                            value: '',
                            autoSelect: false,
                            allowBlank: true,
                            editable: true,
                            emptyText: gettext('auto detect'),
                            deleteEmpty: !me.isCreate,
                        },
                    ],
                    advancedColumn2: [
                        {
                            xtype: 'pmxDiskSelector',
                            name: 'wal_dev',
                            nodename: me.nodename,
                            diskType: 'journal_disks',
                            includePartitions: true,
                            fieldLabel: gettext('WAL Disk'),
                            value: '',
                            autoSelect: false,
                            allowBlank: true,
                            emptyText: gettext('use OSD/DB disk'),
                            listeners: {
                                change: function (field, val) {
                                    me.down('field[name=wal_dev_size]').setDisabled(!val);
                                },
                            },
                        },
                        {
                            xtype: 'numberfield',
                            name: 'wal_dev_size',
                            fieldLabel: `${gettext('WAL size')} (${gettext('GiB')})`,
                            minValue: 0.5,
                            maxValue: 128 * 1024,
                            decimalPrecision: 2,
                            allowBlank: true,
                            disabled: true,
                            emptyText: gettext('Automatic'),
                        },
                    ],
                },
                {
                    xtype: 'displayfield',
                    padding: '5 0 0 0',
                    userCls: 'pmx-hint',
                    value:
                        'Note: Ceph is not compatible with disks backed by a hardware ' +
                        'RAID controller. For details see ' +
                        '<a target="_blank" href="' +
                        Proxmox.Utils.get_help_link('chapter_pveceph') +
                        '">the reference documentation</a>.',
                },
            ],
        });

        me.callParent();
    },
});

Ext.define('PVE.CephRemoveOsd', {
    extend: 'Proxmox.window.Edit',
    alias: ['widget.pveCephRemoveOsd'],

    isRemove: true,

    showProgress: true,
    method: 'DELETE',
    items: [
        {
            xtype: 'proxmoxcheckbox',
            name: 'cleanup',
            checked: true,
            labelWidth: 130,
            fieldLabel: gettext('Cleanup Disks'),
        },
        {
            xtype: 'displayfield',
            name: 'osd-flag-hint',
            userCls: 'pmx-hint',
            value: gettext('Global flags limiting the self healing of Ceph are enabled.'),
            hidden: true,
        },
        {
            xtype: 'displayfield',
            name: 'degraded-objects-hint',
            userCls: 'pmx-hint',
            value: gettext('Objects are degraded. Consider waiting until the cluster is healthy.'),
            hidden: true,
        },
    ],
    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }
        if (me.osdid === undefined || me.osdid < 0) {
            throw 'no osdid specified';
        }

        me.isCreate = true;

        me.title = gettext('Destroy') + ': Ceph OSD osd.' + me.osdid.toString();

        Ext.applyIf(me, {
            url: '/nodes/' + me.nodename + '/ceph/osd/' + me.osdid.toString(),
        });

        me.callParent();

        if (me.warnings.flags) {
            me.down('field[name=osd-flag-hint]').setHidden(false);
        }
        if (me.warnings.degraded) {
            me.down('field[name=degraded-objects-hint]').setHidden(false);
        }
    },
});

Ext.define('PVE.CephSetFlags', {
    extend: 'Proxmox.window.Edit',
    xtype: 'pveCephSetFlags',

    showProgress: true,

    width: 720,
    layout: 'fit',

    onlineHelp: 'pve_ceph_osds',
    isCreate: true,
    title: gettext('Manage Global OSD Flags'),
    submitText: gettext('Apply'),

    items: [
        {
            xtype: 'inputpanel',
            onGetValues: function (values) {
                let me = this;
                let val = {};
                me.down('#flaggrid')
                    .getStore()
                    .each((rec) => {
                        val[rec.data.name] = rec.data.value ? 1 : 0;
                    });

                return val;
            },
            items: [
                {
                    xtype: 'grid',
                    itemId: 'flaggrid',
                    store: {
                        listeners: {
                            update: function () {
                                this.commitChanges();
                            },
                        },
                    },

                    columns: [
                        {
                            text: gettext('Enable'),
                            xtype: 'checkcolumn',
                            width: 75,
                            dataIndex: 'value',
                        },
                        {
                            text: 'Name',
                            dataIndex: 'name',
                        },
                        {
                            text: 'Description',
                            flex: 1,
                            dataIndex: 'description',
                            renderer: Ext.htmlEncode,
                        },
                    ],
                },
            ],
        },
    ],

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        Ext.applyIf(me, {
            url: '/cluster/ceph/flags',
            method: 'PUT',
        });

        me.callParent();

        let grid = me.down('#flaggrid');
        me.load({
            success: function (response, options) {
                let data = response.result.data;
                grid.getStore().setData(data);
                // re-align after store load, else the window is not centered
                me.alignTo(Ext.getBody(), 'c-c');
            },
        });
    },
});

Ext.define('PVE.node.CephOsdTree', {
    extend: 'Ext.tree.Panel',
    alias: ['widget.pveNodeCephOsdTree'],
    onlineHelp: 'chapter_pveceph',

    viewModel: {
        data: {
            nodename: '',
            flags: [],
            maxversion: '0',
            mixedversions: false,
            versions: {},
            isOsd: false,
            downOsd: false,
            upOsd: false,
            inOsd: false,
            outOsd: false,
            osdid: '',
            osdhost: '',
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        reload: function () {
            let me = this;
            let view = me.getView();
            let vm = me.getViewModel();
            let nodename = vm.get('nodename');
            let sm = view.getSelectionModel();
            Proxmox.Utils.API2Request({
                url: '/nodes/' + nodename + '/ceph/osd',
                waitMsgTarget: view,
                method: 'GET',
                failure: function (response, opts) {
                    let msg = response.htmlStatus;
                    PVE.Utils.showCephInstallOrMask(view, msg, nodename, (win) =>
                        view.mon(win, 'cephInstallWindowClosed', () => {
                            me.reload();
                        }),
                    );
                },
                success: function (response, opts) {
                    let data = response.result.data;
                    let selected = view.getSelection();
                    let name;
                    if (selected.length) {
                        name = selected[0].data.name;
                    }
                    data.versions = data.versions || {};
                    vm.set('versions', data.versions);
                    // extract max version
                    let maxversion = '0';
                    let mixedversions = false;
                    let traverse;
                    traverse = function (node, fn) {
                        fn(node);
                        if (Array.isArray(node.children)) {
                            node.children.forEach((c) => {
                                traverse(c, fn);
                            });
                        }
                    };
                    traverse(data.root, (node) => {
                        // compatibility for old api call
                        if (node.type === 'host' && !node.version) {
                            node.version = data.versions[node.name];
                        }

                        if (node.version === undefined) {
                            return;
                        }

                        if (
                            PVE.Utils.compare_ceph_versions(node.version, maxversion) !== 0 &&
                            maxversion !== '0'
                        ) {
                            mixedversions = true;
                        }

                        if (PVE.Utils.compare_ceph_versions(node.version, maxversion) > 0) {
                            maxversion = node.version;
                        }
                    });
                    vm.set('maxversion', maxversion);
                    vm.set('mixedversions', mixedversions);
                    sm.deselectAll();
                    view.setRootNode(data.root);
                    view.expandAll();
                    if (name) {
                        let node = view.getRootNode().findChild('name', name, true);
                        if (node) {
                            view.setSelection([node]);
                        }
                    }

                    let flags = data.flags.split(',');
                    vm.set('flags', flags);
                },
            });
        },

        osd_cmd: function (comp) {
            let me = this;
            let vm = this.getViewModel();
            let cmd = comp.cmd;
            let params = comp.params || {};
            let osdid = vm.get('osdid');

            let doRequest = function () {
                let targetnode = vm.get('osdhost');
                // cmds not node specific and need to work if the OSD node is down
                if (['in', 'out'].includes(cmd)) {
                    targetnode = vm.get('nodename');
                }
                Proxmox.Utils.API2Request({
                    url: `/nodes/${targetnode}/ceph/osd/${osdid}/${cmd}`,
                    waitMsgTarget: me.getView(),
                    method: 'POST',
                    params: params,
                    success: () => {
                        me.reload();
                    },
                    failure: function (response, opts) {
                        Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                    },
                });
            };

            if (cmd === 'scrub') {
                Ext.MessageBox.defaultButton = params.deep === 1 ? 2 : 1;
                Ext.Msg.show({
                    title: gettext('Confirm'),
                    icon: params.deep === 1 ? Ext.Msg.WARNING : Ext.Msg.QUESTION,
                    msg:
                        params.deep !== 1
                            ? Ext.String.format(gettext('Scrub OSD.{0}'), osdid)
                            : Ext.String.format(gettext('Deep Scrub OSD.{0}'), osdid) +
                              '<br>Caution: This can reduce performance while it is running.',
                    buttons: Ext.Msg.YESNO,
                    callback: function (btn) {
                        if (btn !== 'yes') {
                            return;
                        }
                        doRequest();
                    },
                });
            } else {
                doRequest();
            }
        },

        create_osd: function () {
            let me = this;
            let vm = this.getViewModel();
            Ext.create('PVE.CephCreateOsd', {
                nodename: vm.get('nodename'),
                taskDone: () => {
                    me.reload();
                },
            }).show();
        },

        destroy_osd: async function () {
            let me = this;
            let vm = this.getViewModel();

            let warnings = {
                flags: false,
                degraded: false,
            };

            let flagsPromise = Proxmox.Async.api2({
                url: `/cluster/ceph/flags`,
                method: 'GET',
            });

            let statusPromise = Proxmox.Async.api2({
                url: `/cluster/ceph/status`,
                method: 'GET',
            });

            me.getView().mask(gettext('Loading...'));

            try {
                let result = await Promise.all([flagsPromise, statusPromise]);

                let flagsData = result[0].result.data;
                let statusData = result[1].result.data;

                let flags = Array.from(
                    flagsData.filter((v) => v.value),
                    (v) => v.name,
                ).filter((v) => ['norebalance', 'norecover', 'noout'].includes(v));

                if (flags.length) {
                    warnings.flags = true;
                }
                if (Object.keys(statusData.pgmap).includes('degraded_objects')) {
                    warnings.degraded = true;
                }
            } catch (error) {
                Ext.Msg.alert(gettext('Error'), error.htmlStatus);
                me.getView().unmask();
                return;
            }

            me.getView().unmask();
            Ext.create('PVE.CephRemoveOsd', {
                nodename: vm.get('osdhost'),
                osdid: vm.get('osdid'),
                warnings: warnings,
                taskDone: () => {
                    me.reload();
                },
                autoShow: true,
            });
        },

        set_flags: function () {
            let me = this;
            let vm = this.getViewModel();
            Ext.create('PVE.CephSetFlags', {
                nodename: vm.get('nodename'),
                taskDone: () => {
                    me.reload();
                },
            }).show();
        },

        service_cmd: function (comp) {
            let me = this;
            let vm = this.getViewModel();
            let cmd = comp.cmd || comp;

            let doRequest = function () {
                Proxmox.Utils.API2Request({
                    url: `/nodes/${vm.get('osdhost')}/ceph/${cmd}`,
                    params: { service: 'osd.' + vm.get('osdid') },
                    waitMsgTarget: me.getView(),
                    method: 'POST',
                    success: function (response, options) {
                        let upid = response.result.data;
                        let win = Ext.create('Proxmox.window.TaskProgress', {
                            upid: upid,
                            taskDone: () => {
                                me.reload();
                            },
                        });
                        win.show();
                    },
                    failure: function (response, opts) {
                        Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                    },
                });
            };

            if (cmd === 'stop') {
                Proxmox.Utils.API2Request({
                    url: `/nodes/${vm.get('osdhost')}/ceph/cmd-safety`,
                    params: {
                        service: 'osd',
                        id: vm.get('osdid'),
                        action: 'stop',
                    },
                    waitMsgTarget: me.getView(),
                    method: 'GET',
                    success: function ({ result: { data } }) {
                        if (!data.safe) {
                            Ext.Msg.show({
                                title: ngettext('Warning', 'Warnings', 1),
                                message: data.status,
                                icon: Ext.Msg.WARNING,
                                buttons: Ext.Msg.OKCANCEL,
                                buttonText: { ok: gettext('Stop OSD') },
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
                    failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                });
            } else {
                doRequest();
            }
        },

        run_details: function (view, rec) {
            if (rec.data.host && rec.data.type === 'osd' && rec.data.id >= 0) {
                this.details();
            }
        },

        details: function () {
            let vm = this.getViewModel();
            Ext.create('PVE.CephOsdDetails', {
                nodename: vm.get('osdhost'),
                osdid: vm.get('osdid'),
            }).show();
        },

        set_selection_status: function (tp, selection) {
            if (selection.length < 1) {
                return;
            }
            let rec = selection[0];
            let vm = this.getViewModel();

            let isOsd = rec.data.host && rec.data.type === 'osd' && rec.data.id >= 0;

            vm.set('isOsd', isOsd);
            vm.set('downOsd', isOsd && rec.data.status === 'down');
            vm.set('upOsd', isOsd && rec.data.status !== 'down');
            vm.set('inOsd', isOsd && rec.data.in);
            vm.set('outOsd', isOsd && !rec.data.in);
            vm.set('osdid', isOsd ? rec.data.id : undefined);
            vm.set('osdhost', isOsd ? rec.data.host : undefined);
        },

        render_status: function (value, metaData, rec) {
            if (!value) {
                return value;
            }
            let inout = rec.data.in ? 'in' : 'out';
            let updownicon =
                value === 'up' ? 'good fa-arrow-circle-up' : 'critical fa-arrow-circle-down';

            let inouticon = rec.data.in ? 'good fa-circle' : 'warning fa-circle-o';

            let text =
                value +
                ' <i class="fa ' +
                updownicon +
                '"></i> / ' +
                inout +
                ' <i class="fa ' +
                inouticon +
                '"></i>';

            return text;
        },

        render_wal: function (value, metaData, rec) {
            if (!value && rec.data.osdtype === 'bluestore' && rec.data.type === 'osd') {
                return 'N/A';
            }
            return value;
        },

        render_version: function (value, metadata, rec) {
            let vm = this.getViewModel();
            let versions = vm.get('versions');
            let icon = '';
            let version = value || '';
            let maxversion = vm.get('maxversion');
            if (value && PVE.Utils.compare_ceph_versions(value, maxversion) !== 0) {
                let host_version = rec.parentNode?.data?.version || versions[rec.data.host] || '';
                if (
                    rec.data.type === 'host' ||
                    PVE.Utils.compare_ceph_versions(host_version, maxversion) !== 0
                ) {
                    icon = PVE.Utils.get_ceph_icon_html('HEALTH_UPGRADE');
                } else {
                    icon = PVE.Utils.get_ceph_icon_html('HEALTH_OLD');
                }
            } else if (value && vm.get('mixedversions')) {
                icon = PVE.Utils.get_ceph_icon_html('HEALTH_OK');
            }

            return icon + version;
        },

        render_osd_val: function (value, metaData, rec) {
            return rec.data.type === 'osd' ? value : '';
        },
        render_osd_weight: function (value, metaData, rec) {
            if (rec.data.type !== 'osd') {
                return '';
            }
            return Ext.util.Format.number(value, '0.00###');
        },

        render_osd_latency: function (value, metaData, rec) {
            if (rec.data.type !== 'osd') {
                return '';
            }
            let commit_ms = rec.data.commit_latency_ms,
                apply_ms = rec.data.apply_latency_ms;
            return apply_ms + ' / ' + commit_ms;
        },

        render_osd_size: function (value, metaData, rec) {
            return this.render_osd_val(Proxmox.Utils.render_size(value), metaData, rec);
        },

        control: {
            '#': {
                selectionchange: 'set_selection_status',
            },
        },

        init: function (view) {
            let me = this;
            let vm = this.getViewModel();

            if (!view.pveSelNode.data.node) {
                throw 'no node name specified';
            }

            vm.set('nodename', view.pveSelNode.data.node);

            me.callParent();
            me.reload();
        },
    },

    stateful: true,
    stateId: 'grid-ceph-osd',
    rootVisible: false,
    useArrows: true,
    listeners: {
        itemdblclick: 'run_details',
    },

    columns: [
        {
            xtype: 'treecolumn',
            text: 'Name',
            dataIndex: 'name',
            width: 150,
        },
        {
            text: 'Type',
            dataIndex: 'type',
            hidden: true,
            align: 'right',
            width: 75,
        },
        {
            text: gettext('Class'),
            dataIndex: 'device_class',
            align: 'right',
            width: 75,
            renderer: Ext.htmlEncode,
        },
        {
            text: 'OSD Type',
            dataIndex: 'osdtype',
            align: 'right',
            width: 100,
        },
        {
            text: 'Bluestore Device',
            dataIndex: 'blfsdev',
            align: 'right',
            width: 75,
            hidden: true,
            renderer: Ext.htmlEncode,
        },
        {
            text: 'DB Device',
            dataIndex: 'dbdev',
            align: 'right',
            width: 75,
            hidden: true,
            renderer: Ext.htmlEncode,
        },
        {
            text: 'WAL Device',
            dataIndex: 'waldev',
            align: 'right',
            renderer: 'render_wal',
            width: 75,
            hidden: true,
        },
        {
            text: 'Status',
            dataIndex: 'status',
            align: 'right',
            renderer: 'render_status',
            width: 120,
        },
        {
            text: gettext('Version'),
            dataIndex: 'version',
            align: 'right',
            renderer: 'render_version',
        },
        {
            text: 'weight',
            dataIndex: 'crush_weight',
            align: 'right',
            renderer: 'render_osd_weight',
            width: 90,
        },
        {
            text: 'reweight',
            dataIndex: 'reweight',
            align: 'right',
            renderer: 'render_osd_weight',
            width: 90,
        },
        {
            text: gettext('Used') + ' (%)',
            dataIndex: 'percent_used',
            align: 'right',
            renderer: function (value, metaData, rec) {
                if (rec.data.type !== 'osd') {
                    return '';
                }
                return Ext.util.Format.number(value, '0.00');
            },
            width: 100,
        },
        {
            text: gettext('Total'),
            dataIndex: 'total_space',
            align: 'right',
            renderer: 'render_osd_size',
            width: 100,
        },
        {
            text: 'Apply/Commit<br>Latency (ms)',
            dataIndex: 'apply_latency_ms',
            align: 'right',
            renderer: 'render_osd_latency',
            width: 120,
        },
        {
            text: 'PGs',
            dataIndex: 'pgs',
            align: 'right',
            renderer: 'render_osd_val',
            width: 90,
        },
    ],

    tbar: {
        items: [
            {
                text: gettext('Reload'),
                iconCls: 'fa fa-refresh',
                handler: 'reload',
            },
            '-',
            {
                text: gettext('Create: OSD'),
                handler: 'create_osd',
            },
            {
                text: gettext('Manage Global Flags'),
                handler: 'set_flags',
            },
            '->',
            {
                xtype: 'tbtext',
                data: {
                    osd: undefined,
                },
                bind: {
                    data: {
                        osd: '{osdid}',
                    },
                },
                tpl: [
                    '<tpl if="osd">',
                    'osd.{osd}:',
                    '<tpl else>',
                    gettext('No OSD selected'),
                    '</tpl>',
                ],
            },
            {
                text: gettext('Details'),
                iconCls: 'fa fa-info-circle',
                disabled: true,
                bind: {
                    disabled: '{!isOsd}',
                },
                handler: 'details',
            },
            {
                text: gettext('Start'),
                iconCls: 'fa fa-play',
                disabled: true,
                bind: {
                    disabled: '{!downOsd}',
                },
                cmd: 'start',
                handler: 'service_cmd',
            },
            {
                text: gettext('Stop'),
                iconCls: 'fa fa-stop',
                disabled: true,
                bind: {
                    disabled: '{!upOsd}',
                },
                cmd: 'stop',
                handler: 'service_cmd',
            },
            {
                text: gettext('Restart'),
                iconCls: 'fa fa-refresh',
                disabled: true,
                bind: {
                    disabled: '{!upOsd}',
                },
                cmd: 'restart',
                handler: 'service_cmd',
            },
            '-',
            {
                text: 'Out',
                iconCls: 'fa fa-circle-o',
                disabled: true,
                bind: {
                    disabled: '{!inOsd}',
                },
                cmd: 'out',
                handler: 'osd_cmd',
            },
            {
                text: 'In',
                iconCls: 'fa fa-circle',
                disabled: true,
                bind: {
                    disabled: '{!outOsd}',
                },
                cmd: 'in',
                handler: 'osd_cmd',
            },
            '-',
            {
                text: gettext('More'),
                iconCls: 'fa fa-bars',
                disabled: true,
                bind: {
                    disabled: '{!isOsd}',
                },
                menu: [
                    {
                        text: gettext('Scrub'),
                        iconCls: 'fa fa-shower',
                        cmd: 'scrub',
                        handler: 'osd_cmd',
                    },
                    {
                        text: gettext('Deep Scrub'),
                        iconCls: 'fa fa-bath',
                        cmd: 'scrub',
                        params: {
                            deep: 1,
                        },
                        handler: 'osd_cmd',
                    },
                    {
                        text: gettext('Destroy'),
                        itemId: 'remove',
                        iconCls: 'fa fa-fw fa-trash-o',
                        bind: {
                            disabled: '{!downOsd}',
                        },
                        handler: 'destroy_osd',
                    },
                ],
            },
        ],
    },

    fields: [
        'name',
        'type',
        'status',
        'host',
        'in',
        'id',
        { type: 'number', name: 'reweight' },
        { type: 'number', name: 'percent_used' },
        { type: 'integer', name: 'bytes_used' },
        { type: 'integer', name: 'total_space' },
        { type: 'integer', name: 'apply_latency_ms' },
        { type: 'integer', name: 'commit_latency_ms' },
        { type: 'string', name: 'device_class' },
        { type: 'string', name: 'osdtype' },
        { type: 'string', name: 'blfsdev' },
        { type: 'string', name: 'dbdev' },
        { type: 'string', name: 'waldev' },
        {
            type: 'string',
            name: 'version',
            calculate: function (data) {
                return PVE.Utils.parse_ceph_version(data);
            },
        },
        {
            type: 'string',
            name: 'iconCls',
            calculate: function (data) {
                let iconMap = {
                    host: 'fa-building',
                    osd: 'fa-hdd-o',
                    root: 'fa-server',
                };
                return `fa x-fa-tree ${iconMap[data.type] ?? 'fa-folder-o'}`;
            },
        },
        { type: 'number', name: 'crush_weight' },
    ],
});
