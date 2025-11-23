Ext.define('PVE.window.ScheduleSimulator', {
    extend: 'Ext.window.Window',

    title: gettext('Job Schedule Simulator'),

    viewModel: {
        data: {
            simulatedOnce: false,
        },
        formulas: {
            gridEmptyText: (get) =>
                get('simulatedOnce') ? Proxmox.Utils.NoneText : gettext('No simulation done'),
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',
        close: function () {
            this.getView().close();
        },
        simulate: function () {
            let me = this;
            let schedule = me.lookup('schedule').getValue();
            if (!schedule) {
                return;
            }
            let iterations = me.lookup('iterations').getValue() || 10;
            Proxmox.Utils.API2Request({
                url: '/cluster/jobs/schedule-analyze',
                method: 'GET',
                params: {
                    schedule,
                    iterations,
                },
                failure: (response) => {
                    me.getViewModel().set('simulatedOnce', true);
                    me.lookup('grid').getStore().setData([]);
                    Ext.Msg.alert(gettext('Error'), response.htmlStatus);
                },
                success: function (response) {
                    let schedules = response.result.data;
                    me.lookup('grid').getStore().setData(schedules);
                    me.getViewModel().set('simulatedOnce', true);
                },
            });
        },

        scheduleChanged: function (field, value) {
            this.lookup('simulateBtn').setDisabled(!value);
        },

        renderDate: function (value) {
            let date = new Date(value * 1000);
            return date.toLocaleDateString();
        },

        renderTime: function (value) {
            let date = new Date(value * 1000);
            return date.toLocaleTimeString();
        },

        init: function (view) {
            let me = this;
            if (view.schedule) {
                me.lookup('schedule').setValue(view.schedule);
            }
        },
    },

    bodyPadding: 10,
    modal: true,
    resizable: false,
    width: 600,

    layout: 'fit',

    items: [
        {
            xtype: 'inputpanel',
            column1: [
                {
                    xtype: 'pveCalendarEvent',
                    reference: 'schedule',
                    fieldLabel: gettext('Schedule'),
                    listeners: {
                        change: 'scheduleChanged',
                    },
                },
                {
                    xtype: 'proxmoxintegerfield',
                    reference: 'iterations',
                    fieldLabel: gettext('Iterations'),
                    minValue: 1,
                    maxValue: 100,
                    value: 10,
                },
                {
                    xtype: 'container',
                    layout: 'hbox',
                    items: [
                        {
                            xtype: 'box',
                            flex: 1,
                        },
                        {
                            xtype: 'button',
                            reference: 'simulateBtn',
                            text: gettext('Simulate'),
                            handler: 'simulate',
                            disabled: true,
                        },
                    ],
                },
            ],

            column2: [
                {
                    xtype: 'grid',
                    reference: 'grid',
                    bind: {
                        emptyText: '{gridEmptyText}',
                    },
                    scrollable: true,
                    height: 300,
                    columns: [
                        {
                            text: gettext('Date'),
                            renderer: 'renderDate',
                            dataIndex: 'timestamp',
                            flex: 1,
                        },
                        {
                            text: gettext('Time'),
                            renderer: 'renderTime',
                            dataIndex: 'timestamp',
                            align: 'right',
                            flex: 1,
                        },
                    ],
                    store: {
                        fields: ['timestamp'],
                        data: [],
                        sorter: 'timestamp',
                    },
                },
            ],
        },
    ],

    buttons: [
        {
            text: gettext('Done'),
            handler: 'close',
        },
    ],
});
