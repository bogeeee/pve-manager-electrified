Ext.define('pve-osd-details-devices', {
    extend: 'Ext.data.Model',
    fields: ['device', 'type', 'physical_device', 'size', 'support_discard', 'dev_node'],
    idProperty: 'device',
});

Ext.define('PVE.CephOsdDetails', {
    extend: 'Ext.window.Window',
    alias: ['widget.pveCephOsdDetails'],

    mixins: ['Proxmox.Mixin.CBind'],

    cbindData: function () {
        let me = this;
        me.baseUrl = `/nodes/${me.nodename}/ceph/osd/${me.osdid}`;
        return {
            title: `${gettext('Details')}: OSD ${me.osdid}`,
        };
    },

    viewModel: {
        data: {
            device: '',
        },
    },

    modal: true,
    width: 650,
    minHeight: 250,
    resizable: true,
    cbind: {
        title: '{title}',
    },

    layout: {
        type: 'vbox',
        align: 'stretch',
    },
    defaults: {
        layout: 'fit',
        border: false,
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        reload: function () {
            let view = this.getView();

            Proxmox.Utils.API2Request({
                url: `${view.baseUrl}/metadata`,
                waitMsgTarget: view.lookup('detailsTabs'),
                method: 'GET',
                failure: function (response, opts) {
                    Proxmox.Utils.setErrorMask(view.lookup('detailsTabs'), response.htmlStatus);
                },
                success: function (response, opts) {
                    let d = response.result.data;
                    let osdData = Object.keys(d.osd)
                        .sort()
                        .map((x) => ({ key: x, value: d.osd[x] }));
                    view.osdStore.loadData(osdData);
                    let devices = view.lookup('devices');
                    let deviceStore = devices.getStore();
                    deviceStore.loadData(d.devices);

                    view.lookup('osdGeneral').rstore.fireEvent(
                        'load',
                        view.osdStore,
                        osdData,
                        true,
                    );
                    view.lookup('osdNetwork').rstore.fireEvent(
                        'load',
                        view.osdStore,
                        osdData,
                        true,
                    );

                    // select 'block' device automatically on first load
                    if (devices.getSelection().length === 0) {
                        devices.setSelection(deviceStore.findRecord('device', 'block'));
                    }
                },
            });
        },

        showDevInfo: function (grid, selected) {
            let view = this.getView();
            if (selected[0]) {
                let device = selected[0].data.device;
                this.getViewModel().set('device', device);

                let detailStore = view.lookup('volumeDetails');
                detailStore.rstore.getProxy().setUrl(`api2/json${view.baseUrl}/lv-info`);
                detailStore.rstore.getProxy().setExtraParams({ type: device });
                detailStore.setLoading();
                detailStore.rstore.load({ callback: () => detailStore.setLoading(false) });
            }
        },

        init: function () {
            this.reload();
        },

        control: {
            'grid[reference=devices]': {
                selectionchange: 'showDevInfo',
            },
        },
    },
    tbar: [
        {
            text: gettext('Reload'),
            iconCls: 'fa fa-refresh',
            handler: 'reload',
        },
    ],
    initComponent: function () {
        let me = this;

        me.osdStore = Ext.create('Proxmox.data.ObjectStore');

        Ext.applyIf(me, {
            items: [
                {
                    xtype: 'tabpanel',
                    reference: 'detailsTabs',
                    items: [
                        {
                            xtype: 'proxmoxObjectGrid',
                            reference: 'osdGeneral',
                            tooltip: gettext('Various information about the OSD'),
                            rstore: me.osdStore,
                            title: gettext('General'),
                            viewConfig: {
                                enableTextSelection: true,
                            },
                            gridRows: [
                                {
                                    xtype: 'text',
                                    name: 'version',
                                    text: gettext('Version'),
                                },
                                {
                                    xtype: 'text',
                                    name: 'hostname',
                                    text: gettext('Hostname'),
                                },
                                {
                                    xtype: 'text',
                                    name: 'osd_data',
                                    text: gettext('OSD data path'),
                                },
                                {
                                    xtype: 'text',
                                    name: 'osd_objectstore',
                                    text: gettext('OSD object store'),
                                },
                                {
                                    xtype: 'text',
                                    name: 'mem_usage',
                                    text: gettext('Memory usage (PSS)'),
                                    renderer: Proxmox.Utils.render_size,
                                },
                                {
                                    xtype: 'text',
                                    name: 'pid',
                                    text: `${gettext('Process ID')} (PID)`,
                                },
                            ],
                        },
                        {
                            xtype: 'proxmoxObjectGrid',
                            reference: 'osdNetwork',
                            tooltip: gettext('Addresses and ports used by the OSD service'),
                            rstore: me.osdStore,
                            title: gettext('Network'),
                            viewConfig: {
                                enableTextSelection: true,
                            },
                            gridRows: [
                                {
                                    xtype: 'text',
                                    name: 'front_addr',
                                    text: `${gettext('Front Address')}<br>(Client & Monitor)`,
                                    renderer: PVE.Utils.render_ceph_osd_addr,
                                },
                                {
                                    xtype: 'text',
                                    name: 'hb_front_addr',
                                    text: gettext('Heartbeat Front Address'),
                                    renderer: PVE.Utils.render_ceph_osd_addr,
                                },
                                {
                                    xtype: 'text',
                                    name: 'back_addr',
                                    text: `${gettext('Back Address')}<br>(OSD)`,
                                    renderer: PVE.Utils.render_ceph_osd_addr,
                                },
                                {
                                    xtype: 'text',
                                    name: 'hb_back_addr',
                                    text: gettext('Heartbeat Back Address'),
                                    renderer: PVE.Utils.render_ceph_osd_addr,
                                },
                            ],
                        },
                        {
                            xtype: 'panel',
                            title: gettext('Devices'),
                            tooltip: gettext('Physical devices used by the OSD'),
                            items: [
                                {
                                    xtype: 'grid',
                                    border: false,
                                    reference: 'devices',
                                    store: {
                                        model: 'pve-osd-details-devices',
                                    },
                                    columns: {
                                        items: [
                                            { text: gettext('Device'), dataIndex: 'device' },
                                            { text: gettext('Type'), dataIndex: 'type' },
                                            {
                                                text: gettext('Physical Device'),
                                                dataIndex: 'physical_device',
                                            },
                                            {
                                                text: gettext('Size'),
                                                dataIndex: 'size',
                                                renderer: Proxmox.Utils.render_size,
                                            },
                                            {
                                                text: 'Discard',
                                                dataIndex: 'support_discard',
                                                hidden: true,
                                            },
                                            {
                                                text: gettext('Device node'),
                                                dataIndex: 'dev_node',
                                                hidden: true,
                                            },
                                        ],
                                        defaults: {
                                            tdCls: 'pointer',
                                            flex: 1,
                                        },
                                    },
                                },
                                {
                                    xtype: 'proxmoxObjectGrid',
                                    reference: 'volumeDetails',
                                    maskOnLoad: true,
                                    viewConfig: {
                                        enableTextSelection: true,
                                    },
                                    bind: {
                                        title: Ext.String.format(
                                            gettext('Volume Details for {0}'),
                                            '{device}',
                                        ),
                                    },
                                    rows: {
                                        creation_time: {
                                            header: gettext('Creation time'),
                                        },
                                        lv_name: {
                                            header: gettext('LV Name'),
                                        },
                                        lv_path: {
                                            header: gettext('LV Path'),
                                        },
                                        lv_uuid: {
                                            header: gettext('LV UUID'),
                                        },
                                        vg_name: {
                                            header: gettext('VG Name'),
                                        },
                                    },
                                    url: 'nodes/', //placeholder will be set when device is selected
                                },
                            ],
                        },
                    ],
                },
            ],
        });

        me.callParent();
    },
});
